/**
 * The body a webhook delivery sends.
 *
 *   { "id": <delivery id>, "type": "job.completed" | "job.failed" | "ping",
 *     "createdAt": <when the event happened>, "data": { "job": <job> } }
 *
 * `data.job` is the job in the public shape `GET /v1/jobs/:id` answers its
 * owner (`sanitizeJobForPublic` as a non-admin: credits, never USD; no
 * provider; the internal input fields stripped), plus `credit_status` and
 * `credits_charged` through the charge reader — the same two the jobs route
 * adds. The job is read as the delivery owner's, when the first attempt is
 * built; the exact text of that body is kept with the attempt's outcome
 * (migration 521's `payload`) and sent again by every retry, so one event
 * does not change between attempts — unless a sender was cut off before it
 * recorded one, when the next attempt builds afresh. A test ping carries
 * `{ "webhookId" }`.
 *
 * At most MAX_EVENT_BYTES, always: a larger job leaves out `input_data`, then
 * `output_data`, and names what it left out in `data.omitted` — the whole job
 * is one `GET /v1/jobs/:id` away. What is left is short by its nature (ids,
 * statuses, times, numbers, a capped error message); should a text field still
 * be long, it is cut to TEXT_FIELD_MAX_BYTES, which keeps the whole event far
 * under the limit.
 */
import { supabase } from "../supabase.js"
import { PUBLIC_JOB_KEYS, sanitizeJobForPublic, type JobRecord } from "../../routes/jobs.js"
import { fillJobRenderQuality } from "../render-label-fill.js"
import { CHILD_JOB_COLUMN } from "../public-job-data.js"
import { creditStatusMapFor, creditStatusOf, creditsChargedOf } from "../job-credit-status.js"
import { sideHoldChargesFor } from "../job-step-charge.js"
import type { WebhookEventType } from "./event-types.js"

export const MAX_EVENT_BYTES = 64 * 1024
/** A text field's encoded size once input_data and output_data are out and the event is still too large. */
export const TEXT_FIELD_MAX_BYTES = 2048

/**
 * The job columns an event reads: exactly the public ones (so a key added to
 * PUBLIC_JOB_KEYS reaches webhooks with no second list to update), plus what
 * the sanitizer and the credit figures read before they drop it.
 */
export const JOB_EVENT_COLUMNS = [...PUBLIC_JOB_KEYS, "reconcile_attempts", "usage_log_id"].join(", ")

/** A delivery as `claim_webhook_deliveries` hands it out. */
export interface ClaimedDelivery {
  deliveryId: string
  webhookId: string
  userId: string
  jobId: string | null
  event: WebhookEventType
  /** The first attempt's exact body, once there was one. */
  payload: unknown
  /** This attempt's number, 1-based. */
  attempts: number
  createdAt: string
  url: string
  secretCiphertext: string
  /** The secret a rotation replaced, while its grace lasts (it signs too); null otherwise. */
  previousSecretCiphertext: string | null
  runtimeEnv: string
}

export type BuiltEvent =
  | { kind: "body"; body: string; fresh: boolean }
  /** The job is gone (deleted since, or no longer the owner's): nothing to send. */
  | { kind: "missing" }

function isoTime(value: string): string {
  const time = new Date(value)
  return Number.isNaN(time.getTime()) ? value : time.toISOString()
}

function envelope(d: ClaimedDelivery, data: Record<string, unknown>): string {
  return JSON.stringify({ id: d.deliveryId, type: d.event, createdAt: isoTime(d.createdAt), data })
}

/** Whether the delivery's job is a child job (CHILD_JOB_COLUMN). Throws on a database error (the attempt is retried). */
async function isChildJob(jobId: string, deliveryId: string): Promise<boolean> {
  const { data, error } = await supabase.from("jobs").select(CHILD_JOB_COLUMN).eq("id", jobId).maybeSingle()
  if (error) throw new Error(`could not read the job for webhook delivery ${deliveryId}`)
  return (data as Record<string, unknown> | null)?.[CHILD_JOB_COLUMN] != null
}

async function jobFor(d: ClaimedDelivery): Promise<Record<string, unknown> | null> {
  if (!d.jobId) return null
  const { data, error } = await supabase
    .from("jobs")
    .select(JOB_EVENT_COLUMNS)
    .eq("id", d.jobId)
    .eq("user_id", d.userId)
    // A child job is reported only through its parent: the capture records no
    // event for one (migration 550), and should one be queued anyway it reads
    // as gone, so its input is never sent.
    .is(CHILD_JOB_COLUMN, null)
    .maybeSingle()
  if (error) throw new Error(`could not read the job for webhook delivery ${d.deliveryId}`)
  if (!data) return null

  const row = data as unknown as Record<string, unknown>
  const usageLogId = (row.usage_log_id as string | null | undefined) ?? null
  const credits = await creditStatusMapFor([usageLogId])
  const sideCharges = await sideHoldChargesFor([d.jobId])
  return {
    ...(sanitizeJobForPublic(fillJobRenderQuality(row) as unknown as JobRecord, false) as unknown as Record<string, unknown>),
    credit_status: creditStatusOf(usageLogId, credits),
    credits_charged: creditsChargedOf(usageLogId, credits, d.jobId, sideCharges),
  }
}

const encodedBytes = (value: string): number => Buffer.byteLength(JSON.stringify(value), "utf8")

/**
 * `value` cut (with an ellipsis) so its JSON encoding takes at most `maxBytes`,
 * never inside a character. Unchanged when it already fits.
 */
export function cutText(value: string, maxBytes: number): string {
  if (encodedBytes(value) <= maxBytes) return value
  // A character encodes to one byte at least, so no fitting prefix is longer.
  const points: string[] = []
  for (const point of value) {
    if (points.length >= maxBytes) break
    points.push(point)
  }
  let lo = 0
  let hi = points.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (encodedBytes(points.slice(0, mid).join("") + "…") <= maxBytes) lo = mid
    else hi = mid - 1
  }
  return points.slice(0, lo).join("") + "…"
}

/** The job event's body, never over MAX_EVENT_BYTES. */
function jobEventBody(d: ClaimedDelivery, job: Record<string, unknown>): string {
  let body = envelope(d, { job })
  if (Buffer.byteLength(body, "utf8") <= MAX_EVENT_BYTES) return body
  const omitted: string[] = []
  let slim = job
  for (const key of ["input_data", "output_data"] as const) {
    const { [key]: _dropped, ...rest } = slim
    slim = rest
    omitted.push(key)
    body = envelope(d, { job: slim, omitted: [...omitted] })
    if (Buffer.byteLength(body, "utf8") <= MAX_EVENT_BYTES) return body
  }
  const cut = Object.fromEntries(
    Object.entries(slim).map(([key, value]) => [key, typeof value === "string" ? cutText(value, TEXT_FIELD_MAX_BYTES) : value]),
  )
  return envelope(d, { job: cut, omitted })
}

/**
 * What this attempt sends: the first attempt's kept text when there is one,
 * else a fresh body. Throws only when the job could not be read (a database
 * error); the dispatcher retries that attempt.
 */
export async function eventBodyFor(d: ClaimedDelivery): Promise<BuiltEvent> {
  if (typeof d.payload === "string" && d.payload.length > 0) {
    // A kept body is trusted only for a job that is not a child: one recorded
    // for a child (before migration 550 stopped the capture) holds the child's
    // input, so it is never sent again — the job reads as gone.
    if (d.jobId && (await isChildJob(d.jobId, d.deliveryId))) return { kind: "missing" }
    return { kind: "body", body: d.payload, fresh: false }
  }
  if (d.event === "ping") {
    return { kind: "body", body: envelope(d, { webhookId: d.webhookId }), fresh: true }
  }
  const job = await jobFor(d)
  if (!job) return { kind: "missing" }
  return { kind: "body", body: jobEventBody(d, job), fresh: true }
}
