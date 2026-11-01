/**
 * A keyed chat call from a plugin's worker child request
 * (`POST /v1/llm-chat/generate` sent by `tk.http.workerRequest` with an
 * `idempotency-key` header; decided 2026-11-01).
 *
 * The same payer and the same key answer the SAME thing, and nothing is run or
 * charged again:
 *
 *  - The key belongs to the job row from its INSERT (`insertSyncJobIdempotent`,
 *    the `(user_id, idempotency_key)` unique key), so a racing first call loses
 *    at the insert and is answered from the winner's row.
 *  - A repeat is answered here, ahead of the credit guard (no balance check, no
 *    hold): by the recorded answer `{ jobId, generatedText }` exactly as the
 *    first call sent it, marked only by the `X-Dedup-Hit` header. The recorded
 *    text is what counts, not the row's status — a metered call whose settle is
 *    left to the reconcile sweep keeps its row in flight after it answered.
 *  - A failed call spends its key: a repeat is answered 502 with the message the
 *    job recorded (`code` is `llm_error`; the first call's own code is not kept).
 *    A caller that wants another try sends a new key.
 *  - A call still running under the key is WAITED ON (the row polled until it
 *    records an answer). Past the longest a call can run
 *    (`LLM_ROUTE_REQUEST_TIMEOUT_MS` from its start, plus a grace), or while its
 *    row is parked on a human, the repeat is answered as the existing job —
 *    202 `{ jobId, deduped: true }`, as a keyed use-case retry is — never run.
 *  - The key alone decides, WHATEVER the body: a repeat whose body differs (a
 *    restarted step re-uploads its scratch pictures, so their addresses
 *    change under the same key) still replays the first answer, or waits on
 *    it. The fingerprint is kept on the row for the record only. A key that
 *    belongs to another kind of job (not a chat call) has no chat answer to
 *    replay: refused 409 `idempotency_key_reused`, and nothing is created.
 *  - The wait ends at once, with no 202, when the CALLING job is cancelled
 *    (409 `job_cancelled`) or asked to stop (409 `job_stop_requested`) —
 *    checked every poll through the worker's ambient cancellation context,
 *    which a child request runs inside — or when the worker drains (503
 *    `worker_draining`, `Retry-After`); a client that leaves ends it too.
 *  - A row that disappears while waited on (its reservation was refused and
 *    the row removed, or it went to the Trash) frees the key: the repeat runs,
 *    or — when it already lost the insert race — answers 503 `Retry-After`.
 *
 * On a keyless install that relays LLM calls to the cloud
 * (`shouldProxyLlmToCloud`), nothing is claimed here: the key, namespaced by
 * the local user, rides the forwarded request and the cloud dedupes it — one
 * dedupe point, the cloud's (its credit guard's: a repeat is never run or
 * charged twice there, and answers `{ jobId, deduped: true }`).
 *
 * Scope: only a request that carries a parent job in its server-only
 * submission scope. Every other caller, keyed or not, is answered exactly as
 * before (the credit guard's own short dedup). For a keyed child call the
 * header is taken off the request here, so the guard's short `{ jobId,
 * deduped: true }` answer never reaches it: this module owns that key.
 */
import { createHash } from "node:crypto"
import type { FastifyReply, FastifyRequest } from "fastify"
import { supabase } from "./supabase.js"
import { computeFingerprint, MIN_IDEMPOTENCY_KEY_LENGTH } from "./dedup-fingerprint.js"
import { IDEMPOTENCY_HEADER } from "./idempotency-header.js"
import { jobSubmissionParentJobId } from "./job-submission-context.js"
import { isParkedJobStatus } from "./job-status.js"
import { LLM_ROUTE_REQUEST_TIMEOUT_MS } from "./llm-route-timeout.js"
import { shouldProxyLlmToCloud } from "./cloud-llm-proxy.js"
import { JobCancelledError, JobStopRequestedError, throwIfJobCancelled } from "./job-cancellation.js"
import { isWorkerDraining, workerDrainSignal } from "./worker-drain.js"

/** The `input_data.type` of a chat job (`buildJobInputData(…, "llm-chat")`). */
export const LLM_CHAT_JOB_TYPE = "llm-chat"

/** The columns a keyed chat row is judged by (a PostgREST select list). */
export const KEYED_CHAT_COLUMNS =
  "id, status, input_fingerprint, output_data, error_message, run_type:input_data->>type, started_at, created_at"

/** A keyed chat row as {@link KEYED_CHAT_COLUMNS} reads it. */
export interface KeyedChatRow {
  readonly id: string
  readonly status?: string | null
  readonly input_fingerprint?: string | null
  readonly output_data?: Record<string, unknown> | null
  readonly error_message?: string | null
  readonly run_type?: string | null
  readonly started_at?: string | null
  readonly created_at?: string | null
}

/** How often a repeat re-reads the row of a call still running. */
export const KEYED_CHAT_POLL_MS = 500

/** Past a call's own longest run: the time its route may take to write its answer down. */
export const KEYED_CHAT_WAIT_GRACE_MS = 30_000

export const LLM_CHAT_KEY_REUSED = {
  code: "idempotency_key_reused",
  message: "This Idempotency-Key was already used for another kind of request. Use a new key.",
} as const

const keyedCalls = new WeakMap<FastifyRequest, { readonly key: string; readonly fingerprint: string }>()

/** The key and body fingerprint of a keyed child call ({@link claimKeyedChatCall} set them), else undefined. */
export function keyedChatCallOf(req: FastifyRequest): { readonly key: string; readonly fingerprint: string } | undefined {
  return keyedCalls.get(req)
}

const relayKeys = new WeakMap<FastifyRequest, string>()

/**
 * The key a relayed keyed child call forwards to the cloud: the caller's key
 * hashed with its local user, since every user of an install relays as the one
 * connected account — two users' equal keys must never share an answer there.
 */
export function relayIdempotencyKey(userId: string, key: string): string {
  return `relay-${createHash("sha256").update(`${userId}:${key}`).digest("hex").slice(0, 48)}`
}

/** The key to forward when this keyed child call is relayed to the cloud ({@link claimKeyedChatCall}), else undefined. */
export function relayIdempotencyKeyOf(req: FastifyRequest): string | undefined {
  return relayKeys.get(req)
}

function parentJobOf(req: FastifyRequest): string | undefined {
  try {
    return jobSubmissionParentJobId(req)
  } catch {
    // A scope of another user: the insert refuses it, as before.
    return undefined
  }
}

function headerKeyOf(req: FastifyRequest): string | undefined {
  const raw = req.headers[IDEMPOTENCY_HEADER]
  const key = typeof raw === "string" ? raw.trim() : ""
  return key.length >= MIN_IDEMPOTENCY_KEY_LENGTH ? key : undefined
}

/**
 * The route's first preHandler, ahead of the credit guard: claims the key of a
 * keyed child call and answers a repeat. Does nothing for any other request.
 */
export async function claimKeyedChatCall(req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined> {
  if (!req.userId || parentJobOf(req) === undefined) return undefined
  const key = headerKeyOf(req)
  if (!key) return undefined
  if (await shouldProxyLlmToCloud()) {
    // A keyless install relays the call to the cloud: the CLOUD is the one
    // dedupe point. Nothing is claimed here (the local guard sees no key); the
    // key is forwarded, namespaced by this install's user.
    relayKeys.set(req, relayIdempotencyKey(req.userId, key))
    delete req.headers[IDEMPOTENCY_HEADER]
    return undefined
  }
  const fingerprint = computeFingerprint(req.url, req.body)
  keyedCalls.set(req, { key, fingerprint })
  delete req.headers[IDEMPOTENCY_HEADER]
  const existing = await readKeyedChatRow(req.userId, key)
  if (!existing) return undefined
  // A row gone while this repeat waited freed the key: this call runs.
  return answerKeyedChat(req, reply, existing, "run")
}

/** The caller's row under `key`, or null (none, or the read failed: the keyed insert is the backstop). */
async function readKeyedChatRow(userId: string, key: string): Promise<KeyedChatRow | null> {
  try {
    const { data, error } = await supabase
      .from("jobs") // trash-read: a keyed repeat is answered from its own row wherever it is
      .select(KEYED_CHAT_COLUMNS)
      .eq("user_id", userId)
      .eq("idempotency_key", key)
      .maybeSingle()
    if (error) return null
    return (data as KeyedChatRow | null) ?? null
  } catch {
    return null
  }
}

async function readChatRowById(id: string): Promise<KeyedChatRow | null> {
  const { data, error } = await supabase
    .from("jobs") // tenant-scope-ignore: the id is the caller's own keyed row, read above by user_id
    .select(KEYED_CHAT_COLUMNS)
    .eq("id", id)
    .maybeSingle()
  if (error) throw new Error(`keyed chat read failed: ${error.message}`)
  return (data as KeyedChatRow | null) ?? null
}

type Answer = { readonly status: number; readonly body: unknown }

/** What a row already answered, or undefined while it is still running. */
export function recordedChatAnswer(row: KeyedChatRow): Answer | undefined {
  const out = row.output_data ?? {}
  if (typeof out.generatedText === "string") {
    return { status: 200, body: { jobId: row.id, generatedText: out.generatedText } }
  }
  const failed = row.status === "failed" || row.status === "cancelled"
  if (failed || typeof out.error === "string") {
    const message =
      (failed && row.error_message) || (typeof out.error === "string" && out.error) || row.error_message || "LLM API call failed"
    return { status: 502, body: { error: { code: "llm_error", message } } }
  }
  if (row.status === "completed") {
    // Completed with no text recorded: nothing to replay but the job itself.
    return { status: 202, body: { jobId: row.id, deduped: true } }
  }
  return undefined
}

/** When a repeat stops waiting for a running row: its start + the longest call + the grace. */
export function keyedChatWaitDeadline(row: KeyedChatRow): number {
  const startedAt = Date.parse(row.started_at ?? row.created_at ?? "")
  const from = Number.isFinite(startedAt) ? startedAt : Date.now()
  return from + LLM_ROUTE_REQUEST_TIMEOUT_MS + KEYED_CHAT_WAIT_GRACE_MS
}

/** Sleep `ms`, woken early when `signal` aborts. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve()
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener("abort", done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener("abort", done, { once: true })
  })
}

/** The calling job was cancelled while its repeat waited (the answer `stampSyncLlmCallStart` gives a cancelled call). */
export const KEYED_WAIT_JOB_CANCELLED = {
  code: "job_cancelled",
  message: "The job was cancelled while this request waited for its earlier answer — nothing was charged.",
} as const
/** The calling job was asked to stop gracefully while its repeat waited. */
export const KEYED_WAIT_JOB_STOPPED = {
  code: "job_stop_requested",
  message: "The job was asked to stop while this request waited for its earlier answer — nothing was charged.",
} as const
/** The worker is draining (a deploy): the wait ends so the job can be handed back; a retry under the key replays. */
export const KEYED_WAIT_WORKER_DRAINING = {
  code: "worker_draining",
  message: "The worker is restarting. Retry with the same key — it answers the earlier call.",
} as const

/**
 * Why a repeat must stop waiting now, as its answer — or undefined to wait on.
 * The CALLING job's own cancel or graceful stop (the worker's ambient check,
 * `throwIfJobCancelled`: a child request runs inside its parent job's
 * cancellation context; the row is read at most every 4 s) and the worker's
 * drain. Never a 202: the caller learns exactly why it got no answer.
 */
async function waitStopped(): Promise<{ status: number; error: { code: string; message: string }; retryAfter?: true } | undefined> {
  if (isWorkerDraining()) return { status: 503, error: KEYED_WAIT_WORKER_DRAINING, retryAfter: true }
  try {
    await throwIfJobCancelled()
  } catch (err) {
    if (err instanceof JobCancelledError) return { status: 409, error: KEYED_WAIT_JOB_CANCELLED }
    if (err instanceof JobStopRequestedError) return { status: 409, error: KEYED_WAIT_JOB_STOPPED }
    // A failed status read is no cancel: wait on.
  }
  return undefined
}

/** The answer while the key's row vanished mid-wait and this request cannot run itself (the guard's own race answer). */
export const KEY_ROW_VANISHED = {
  code: "dedup_race_winner_unresolvable",
  message: "The request under this Idempotency-Key ended without an answer. Retry it with the same key.",
} as const

/**
 * Answer a repeat of a keyed child call from the row its key already holds:
 * refused when the key belongs to another kind of job, else the recorded answer
 * (whatever this request's body),
 * waiting for it while the call runs.
 *
 * A row that disappears while it is waited on (its reservation was refused and
 * the row removed, or it went to the Trash) frees the key. `ifVanished: "run"`
 * — the preHandler, before anything is checked — then answers nothing
 * (`undefined`) and this request runs as the first under the key; `"retry"` —
 * the loser of the insert race, past its own checks — answers 503 with
 * `Retry-After`, as the guard's lost race does.
 */
export async function answerKeyedChat(
  req: FastifyRequest,
  reply: FastifyReply,
  found: KeyedChatRow,
  ifVanished: "run" | "retry",
): Promise<FastifyReply | undefined> {
  // Another kind of job under the key: nothing a chat call could replay. The
  // body is NOT compared — the key alone decides (see the module comment).
  if (found.run_type !== LLM_CHAT_JOB_TYPE) return reply.status(409).send({ error: LLM_CHAT_KEY_REUSED })
  const deadline = keyedChatWaitDeadline(found)
  // The client leaving (the response's `close` before it finished — never the
  // request's, which fires once the body is read) or the worker's drain wakes
  // the wait at once.
  const gone = new AbortController()
  reply.raw.once("close", () => {
    if (!reply.raw.writableFinished) gone.abort()
  })
  const wake = AbortSignal.any([gone.signal, workerDrainSignal()])
  let row: KeyedChatRow = found
  for (;;) {
    const answer = recordedChatAnswer(row)
    if (answer) return reply.header("X-Dedup-Hit", "1").status(answer.status).send(answer.body)
    if (isParkedJobStatus(row.status ?? "") || Date.now() >= deadline) break
    const stopped = await waitStopped()
    if (stopped) {
      if (stopped.retryAfter) reply.header("Retry-After", "2")
      return reply.status(stopped.status).send({ error: stopped.error })
    }
    // Nobody is left to read an answer: stop polling for one.
    if (gone.signal.aborted) return reply.status(499).send({ error: { code: "client_closed", message: "The client closed the request." } })
    await sleep(Math.min(KEYED_CHAT_POLL_MS, Math.max(0, deadline - Date.now())), wake)
    if (wake.aborted) continue
    let read: KeyedChatRow | null
    try {
      read = await readChatRowById(found.id)
    } catch {
      // One failed read changes nothing: the next poll reads again.
      continue
    }
    if (!read) {
      if (ifVanished === "run") return undefined
      return reply.status(503).header("Retry-After", "2").send({ error: KEY_ROW_VANISHED })
    }
    row = read
  }
  return reply.header("X-Dedup-Hit", "1").status(202).send({ jobId: found.id, deduped: true })
}
