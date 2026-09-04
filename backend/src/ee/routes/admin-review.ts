import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../../lib/supabase.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { streamR2Object } from "../../lib/storage.js"
import { resolveHeldJob } from "../../lib/job-policy-review.js"
import { isOwnedOrRelayedObjectKey } from "../../lib/job-policy-outputs.js"
import { IMAGE_JOB_TYPES, VIDEO_JOB_TYPES, AUDIO_JOB_TYPES } from "../../lib/job-finalize.js"

/**
 * The review surface — six routes under `/v1/admin/review` (spec §8).
 *
 * WHY A ROUTE AND NOT POSTGREST. Migration 347 revoked table-level SELECT on
 * `public.jobs` from `authenticated` and granted back four columns. An admin's
 * JWT is the role `authenticated` like everyone else's; `is_admin()` is an RLS
 * predicate and cannot restore a COLUMN privilege, and PostgREST answers
 * `401 42501` for the whole request rather than dropping the ungranted column.
 * Every field this page renders is on the wrong side of that grant — the same
 * reason `admin-jobs.ts` exists. `job_policy_decisions` is stricter still:
 * migration 377 enables RLS with NO policies and REVOKEs from anon and
 * authenticated, so it is reachable ONLY through this service-role client.
 *
 * TWO PROMISES THIS FILE KEEPS, both of which are the point of `hold`:
 *
 * 1. **No URL ever leaves here.** The list and the decisions log carry no
 *    `output_data`, no `held_*` column and no minted public URL. `hold` is the
 *    one place the platform promises the output is not exposed, and a public
 *    URL survives the review in browser history, in the referrer chain and in
 *    a screenshot. `admin-review-guard.test.ts` greps this file for the
 *    public-URL minters and the key-from-URL derivation and fails the build if
 *    any of them appears here — which is why they are not named in this
 *    comment either.
 * 2. **The preview key is read server-side, by bounded index, out of
 *    `jobs.held_objects`** — never from client input, never re-derived from a
 *    URL (the key-from-URL helper in `lib/storage.ts` is lossy — null when no
 *    public base is configured, null on a fallback domain, D7). Without that
 *    rule this route is an authenticated read-anything proxy over the bucket.
 *
 * AUTHZ is `requireAdmin` on all six, NOT `requirePlatformOperator` (D27): not
 * one refund route is operator-gated today, the operator charter is *minting*,
 * and under migration 362 the payer is the debit user — so on the hosted
 * instance approve debits the operator's own prepaid account and reject
 * refunds it. An operator gate would mean the customer cannot run the queue
 * that is the feature. The residual risk (hold-everything / reject-everything)
 * is mitigated here by shape rather than by a gate: there is **no bulk verb**
 * (one job per POST), every resolution records its resolver, and the decisions
 * tab makes the pattern visible.
 *
 * NOT HERE, on purpose: `providerCost` (Q11 — on the hosted instance the
 * "admin" reading this page is the customer, and our USD unit cost is exactly
 * what 347 was written to stop showing them) and any delete verb (the preview
 * is read-only; rejection deletes, through `resolveHeldJob`).
 */

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

type MediaKind = "image" | "video" | "audio" | "other"

const IMAGE = new Set<string>(IMAGE_JOB_TYPES)
const VIDEO = new Set<string>(VIDEO_JOB_TYPES)
const AUDIO = new Set<string>(AUDIO_JOB_TYPES)

/** Derived, never stored: `lib/job-finalize.ts` already owns this
 *  classification and `job-finalize-types.test.ts` asserts the three arrays are
 *  pairwise disjoint, so a new generation type classifies the day it is added
 *  there. `"other"` renders as a download-only row, not a broken `<video>`. */
function mediaKindFor(jobType: string | null): MediaKind {
  if (!jobType) return "other"
  if (IMAGE.has(jobType)) return "image"
  if (VIDEO.has(jobType)) return "video"
  if (AUDIO.has(jobType)) return "audio"
  return "other"
}

/** As stored in `jobs.held_objects` (D7) — keys, never URLs. */
interface HeldObjectRow {
  key: string
  kind?: MediaKind
  index?: number
  sizeBytes?: number
}

interface HeldJobRow {
  id: string
  user_id: string | null
  job_type: string | null
  status: string
  credits: number | null
  source: string | null
  source_detail: string | null
  created_at: string
  held_at: string | null
  held_objects: HeldObjectRow[] | null
  input_data: Record<string, unknown> | null
}

interface DecisionRow {
  id: string
  job_id: string | null
  hook_point: string
  policy_id: string
  verdict: string
  reason: string | null
  resolver_email: string | null
  created_at: string
}

/** Exactly the columns the queue renders. `output_data`, `held_output_data`
 *  and `error_hint` are deliberately absent: the held payload is the thing
 *  being kept out of circulation, and `held_objects` is selected only to count
 *  and to index into — it never reaches the wire. */
const REVIEW_JOB_COLUMNS =
  "id, user_id, job_type, status, credits, source, source_detail, created_at, held_at, held_objects"

interface QueueRow {
  jobId: string
  userId: string | null
  jobType: string | null
  mediaKind: MediaKind
  outputCount: number
  credits: number
  createdAt: string
  heldAt: string | null
  heldForMinutes: number
  policyId: string | null
  reason: string | null
  source: string | null
  sourceDetail: string | null
}

function toQueueRow(job: HeldJobRow, decision: DecisionRow | undefined, now: number): QueueRow {
  const heldAt = job.held_at ?? decision?.created_at ?? null
  return {
    jobId: job.id,
    userId: job.user_id,
    jobType: job.job_type,
    mediaKind: mediaKindFor(job.job_type),
    outputCount: Array.isArray(job.held_objects) ? job.held_objects.length : 0,
    credits: Number(job.credits ?? 0),
    createdAt: job.created_at,
    heldAt,
    heldForMinutes: heldAt ? Math.max(0, Math.floor((now - new Date(heldAt).getTime()) / 60_000)) : 0,
    policyId: decision?.policy_id ?? null,
    reason: decision?.reason ?? null,
    source: job.source,
    sourceDetail: job.source_detail,
  }
}

function toDecisionRow(row: DecisionRow) {
  return {
    id: row.id,
    jobId: row.job_id,
    hookPoint: row.hook_point,
    policyId: row.policy_id,
    verdict: row.verdict,
    reason: row.reason,
    resolverEmail: row.resolver_email,
    createdAt: row.created_at,
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const listQuery = z.object({
  page: z.coerce.number().int().min(0).default(0),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  policyId: z.string().max(64).optional(),
  userId: z.string().uuid().optional(),
})

const jobParams = z.object({ jobId: z.string().uuid() })

const outputParams = z.object({
  jobId: z.string().uuid(),
  // A held job has one output, occasionally a handful of image variants.
  // Bounded (MAX_HELD_OBJECTS - 1) so a scan of :index is a scan of nothing.
  index: z.coerce.number().int().min(0).max(16),
})

const approveBody = z.object({ note: z.string().max(500).optional() })

/** `reason` is USER-VISIBLE: it becomes `error_hint.reason`, `error_hint` is on
 *  `PUBLIC_JOB_KEYS` and it lands verbatim on the owner's canvas. Hence
 *  required (a rejection with no explanation is a support ticket) and bounded
 *  at 500 — `admin-messages.ts:69`'s `MAX_ERROR_LEN`, for the same reason. */
const rejectBody = z.object({ reason: z.string().trim().min(1).max(500) })

const decisionsQuery = z.object({
  page: z.coerce.number().int().min(0).default(0),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  jobId: z.string().uuid().optional(),
  policyId: z.string().max(64).optional(),
  verdict: z.enum(["allow", "flag", "block", "hold", "approve", "reject", "withdrawn"]).optional(),
  hookPoint: z.enum(["request", "result", "review"]).optional(),
  since: z.string().datetime().optional(),
})

/** `job_policy_decisions` landed in migration 377 and is not in the generated
 *  Supabase types yet, so the table name is cast the way `job-policy-audit.ts`
 *  casts it. The cast buys nothing but the table name — every column this file
 *  reads is spelled out in a `select`. */
function decisionsTable() {
  return supabase.from("job_policy_decisions" as "assets") as unknown as ReturnType<typeof supabase.from>
}

/**
 * The far end's job id for a job in review, from wherever it currently lives.
 *
 * TWO PLACES, and the order matters. A held row's completion columns are PARKED
 * (`markJobHeld` writes `held_completion_fields` and never runs the completion
 * UPDATE), so for everything the capability router relayed — a self-host's
 * principal traffic — the `relay_job_id` COLUMN is still NULL for exactly as
 * long as the job is reviewable. It starts answering only after
 * `approveHeldJob` spreads those columns back. The replay lanes
 * (providers/nodaro/run-on-cloud.ts) stamp the column directly and are covered
 * by the first branch.
 *
 * Both sources are SERVER-WRITTEN: migration 383 adds no UPDATE grant on
 * `relay_job_id`, and `held_completion_fields` is outside migration 347's
 * authenticated column grant. The `typeof` narrowing is not decoration — it is
 * what stops a non-string sneaking into the key-family test.
 */
function relayStemOf(job: {
  relay_job_id: string | null
  held_completion_fields: Record<string, unknown> | null
}): string | null {
  if (typeof job.relay_job_id === "string" && job.relay_job_id) return job.relay_job_id
  const parked = job.held_completion_fields?.relay_job_id
  return typeof parked === "string" && parked ? parked : null
}

/** A safety belt on the `?policyId=` narrowing, NOT its correctness boundary
 *  (see the query for why that changed). Every id it returns becomes ~40 bytes
 *  of `in.(…)` in the jobs request line, so an unbounded list would eventually
 *  stop being a short queue and start being a 500 from whatever sits in front
 *  of PostgREST. Bounded to the open queue, reaching this is already a
 *  four-figure backlog. */
const MAX_POLICY_FILTER_JOBS = 1000

function validationError(message: string) {
  return { error: { code: "validation_error", message } }
}

const NOT_FOUND = { error: { code: "not_found", message: "No job awaiting review with that id" } }

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export async function adminReviewRoutes(app: FastifyInstance): Promise<void> {
  /**
   * The acting admin's address, denormalised onto the audit row so a decision
   * does not become anonymous when that admin leaves. A swallowed error here
   * would write null and make the log say "an admin since removed" about
   * someone still employed — so it is logged, loudly (the
   * `admin-messages.ts:385-395` precedent), and the resolution proceeds.
   */
  async function reviewerFor(req: { userId?: string; log: { error: (o: unknown, m: string) => void } }) {
    const userId = req.userId as string
    const { data, error } = await supabase
      .from("profiles")
      .select("email")
      .eq("id", userId)
      .maybeSingle()
    if (error) {
      req.log.error({ err: error, userId }, "could not read the reviewing admin's email — the decision row will not name them")
    }
    const email = (data as { email?: string | null } | null)?.email ?? null
    return { userId, email }
  }

  /** The `hold` decision behind each held job. The job's STATUS is the
   *  authority for what is reviewable (a job cancelled out from under its hold
   *  must not appear), so this is a decoration lookup, not a filter: two
   *  selects and an in-memory join at a cardinality of ≤100. Deliberately not
   *  an RPC or a view — do not "optimise" it into one. */
  async function holdDecisionsFor(jobIds: string[]): Promise<Map<string, DecisionRow>> {
    const byJob = new Map<string, DecisionRow>()
    if (jobIds.length === 0) return byJob
    const { data } = await decisionsTable()
      .select("id, job_id, hook_point, policy_id, verdict, reason, resolver_email, created_at")
      .eq("hook_point", "result")
      .eq("verdict", "hold")
      .in("job_id", jobIds)
      .order("created_at", { ascending: false })
    for (const row of (data ?? []) as unknown as DecisionRow[]) {
      if (row.job_id && !byJob.has(row.job_id)) byJob.set(row.job_id, row)
    }
    return byJob
  }

  app.get("/v1/admin/review/jobs", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = listQuery.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send(validationError(parsed.error.issues[0]?.message ?? "Invalid query"))
    }
    const { page, pageSize, policyId, userId } = parsed.data

    // A `policyId` filter lives on the decision, not on the job, so it narrows
    // the job ids FIRST — filtering after the join would shrink pages and lie
    // about `total`.
    //
    // It narrows to the policy's OPEN holds, and the join is what makes that
    // true. `job_policy_decisions` is APPEND-ONLY: approve, reject and withdraw
    // INSERT a fresh `review` row and never touch the `hold` row, so every hold
    // a policy ever emitted is still there. Selecting "the N most recent holds
    // by this policy" is therefore a LIFETIME window that long-resolved holds
    // keep consuming — and the rows it drops are the OLDEST, which is precisely
    // the head of a queue whose contract is `order("held_at", ascending)`. They
    // would disappear from `total` with them, because the jobs query below
    // carries `count: "exact"`. `job_id` has a real FK to `jobs` (migration
    // 377), so one inner embed bounds the set by the size of the OPEN queue
    // instead of by lifetime volume.
    let policyJobIds: string[] | null = null
    if (policyId) {
      const { data, error } = await decisionsTable()
        .select("job_id, jobs!inner(status)")
        .eq("hook_point", "result")
        .eq("verdict", "hold")
        .eq("policy_id", policyId)
        .eq("jobs.status", "pending_review")
        // Oldest first: if the safety belt ever bites it must truncate the TAIL
        // of the FIFO. Newest-first is what dropped the head.
        .order("created_at", { ascending: true })
        .limit(MAX_POLICY_FILTER_JOBS)
      if (error) {
        // Answering `[]` here would read as "nothing is awaiting review under
        // that policy" — the most dangerous wrong answer this page can give.
        req.log.error({ err: error, policyId }, "admin/review/jobs policy filter lookup failed")
        return reply.status(500).send({ error: { code: "internal_error", message: "Lookup failed" } })
      }
      policyJobIds = [...new Set(((data ?? []) as unknown as { job_id: string | null }[]).map((r) => r.job_id).filter((v): v is string => Boolean(v)))]
      if (policyJobIds.length === 0) {
        return reply.send({ data: [], total: 0, page, pageSize })
      }
    }

    let query = supabase
      .from("jobs")
      .select(REVIEW_JOB_COLUMNS, { count: "exact" })
      // A review queue is a FIFO; oldest first, like `admin-stuck-pipelines`.
      .eq("status", "pending_review")
      .order("held_at", { ascending: true })
      .range(page * pageSize, (page + 1) * pageSize - 1)
    if (userId) query = query.eq("user_id", userId)
    if (policyJobIds) query = query.in("id", policyJobIds)

    const { data, error, count } = await query
    if (error) {
      req.log.error({ err: error }, "admin/review/jobs lookup failed")
      return reply.status(500).send({ error: { code: "internal_error", message: "Lookup failed" } })
    }
    const jobs = (data ?? []) as unknown as HeldJobRow[]
    const decisions = await holdDecisionsFor(jobs.map((j) => j.id))
    const now = Date.now()
    return reply.send({
      data: jobs.map((j) => toQueueRow(j, decisions.get(j.id), now)),
      total: count ?? jobs.length,
      page,
      pageSize,
    })
  })

  app.get<{ Params: { jobId: string } }>("/v1/admin/review/jobs/:jobId", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = jobParams.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send(validationError(parsed.error.issues[0]?.message ?? "Invalid job id"))
    }
    const { data } = await supabase
      .from("jobs")
      .select(`${REVIEW_JOB_COLUMNS}, input_data`)
      .eq("id", parsed.data.jobId)
      .single()
    const job = (data ?? null) as unknown as HeldJobRow | null
    // A resolved job's withheld output is not a thing an admin may re-open.
    if (!job || job.status !== "pending_review") return reply.status(404).send(NOT_FOUND)

    const decisions = await holdDecisionsFor([job.id])
    const objects = Array.isArray(job.held_objects) ? job.held_objects : []
    return reply.send({
      data: {
        ...toQueueRow(job, decisions.get(job.id), Date.now()),
        // Raw, for an admin — the same stance `sanitizeJobForPublic`'s admin
        // branch takes. It is on the DETAIL route only: it can carry the
        // prompt that produced the held content and the queue is a 25-row
        // render.
        inputData: job.input_data,
        // The manifest names the FILE. The key is what the preview route reads
        // server-side; handing it to the browser would invite a client-chosen
        // key on the way back.
        outputs: objects.map((o, i) => ({
          index: i,
          mediaKind: o.kind ?? mediaKindFor(job.job_type),
          filename: o.key.split("/").pop() ?? "",
          sizeBytes: o.sizeBytes ?? null,
        })),
      },
    })
  })

  app.get<{ Params: { jobId: string; index: string } }>("/v1/admin/review/jobs/:jobId/output/:index", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = outputParams.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send(validationError(parsed.error.issues[0]?.message ?? "Invalid output index"))
    }
    const { jobId, index } = parsed.data

    // Re-read the status INSIDE the handler: the queue page may be minutes
    // stale, and an approved or rejected job's bytes are no longer reviewable.
    // `held_completion_fields` is selected for ONE field and never reaches the
    // wire (this handler streams bytes; the manifest route does not select it).
    // It is where a held row's `relay_job_id` actually lives — see relayStemOf.
    const { data } = await supabase
      .from("jobs")
      .select("id, status, held_objects, relay_job_id, held_completion_fields")
      .eq("id", jobId)
      .single()
    const job = (data ?? null) as unknown as {
      status: string
      held_objects: HeldObjectRow[] | null
      relay_job_id: string | null
      held_completion_fields: Record<string, unknown> | null
    } | null
    if (!job || job.status !== "pending_review") return reply.status(404).send(NOT_FOUND)

    const objects = Array.isArray(job.held_objects) ? job.held_objects : []
    const object = objects[index]
    // Ownership by key family, re-checked HERE — the same predicate
    // `deleteOwnedObjects` refuses on, deliberately shared rather than
    // re-spelled. `held_objects` is normally written by the result gate out of
    // `ownedHeldObjects`, so this is a no-op on every real row; it matters when
    // something else put the row in `pending_review` (migration 377's widened
    // CHECK made that status reachable from PostgREST until the same migration
    // narrowed the INSERT policy). Without it, one planted array turns this
    // route into an authenticated read-anything proxy over the bucket.
    // Two stems, both from the ROW: this job's id, and — on a relayed row — the
    // far end's, which under the shared-bucket passthrough is the stem its
    // outputs actually carry. Neither comes from the request, so the "planted
    // array ⇒ read-anything proxy" property this check exists for is preserved.
    if (!object?.key || !isOwnedOrRelayedObjectKey(jobId, relayStemOf(job), object.key)) {
      return reply.status(404).send(NOT_FOUND)
    }

    const range = typeof req.headers.range === "string" ? req.headers.range : undefined
    const obj = await streamR2Object(object.key, range ? { range } : {})
    if (!obj) return reply.status(404).send(NOT_FOUND)

    reply
      .header("Cache-Control", "private, no-store")
      .header("X-Content-Type-Options", "nosniff")
      .header("Content-Disposition", "inline")
      .header("Accept-Ranges", "bytes")
      // From the OBJECT, never from the request.
      .header("Content-Type", obj.contentType ?? "application/octet-stream")
    if (obj.contentLength !== null) reply.header("Content-Length", String(obj.contentLength))
    if (obj.contentRange) {
      reply.header("Content-Range", obj.contentRange).status(206)
    }
    return reply.send(obj.body)
  })

  app.post<{ Params: { jobId: string } }>("/v1/admin/review/jobs/:jobId/approve", { preHandler: requireAdmin }, async (req, reply) => {
    const params = jobParams.safeParse(req.params)
    if (!params.success) {
      return reply.status(400).send(validationError(params.error.issues[0]?.message ?? "Invalid job id"))
    }
    const body = approveBody.safeParse(req.body ?? {})
    if (!body.success) {
      return reply.status(400).send(validationError(body.error.issues[0]?.message ?? "Invalid body"))
    }
    const resolver = await reviewerFor(req)
    // `note` is OPERATOR-ONLY — it goes to the audit row and never to
    // `error_hint`. Forwarded as a non-fresh object so it survives today (when
    // `ReviewAction["approve"]` does not declare it yet — see the handoff to
    // the review lib) and lands on the row the moment it does.
    const action = { action: "approve" as const, resolver, ...(body.data.note ? { note: body.data.note } : {}) }
    const result = await resolveHeldJob(params.data.jobId, action)
    return sendResolution(reply, params.data.jobId, "completed", result)
  })

  app.post<{ Params: { jobId: string } }>("/v1/admin/review/jobs/:jobId/reject", { preHandler: requireAdmin }, async (req, reply) => {
    const params = jobParams.safeParse(req.params)
    if (!params.success) {
      return reply.status(400).send(validationError(params.error.issues[0]?.message ?? "Invalid job id"))
    }
    const body = rejectBody.safeParse(req.body ?? {})
    if (!body.success) {
      return reply.status(400).send(validationError(body.error.issues[0]?.message ?? "A reason is required"))
    }
    const resolver = await reviewerFor(req)
    const result = await resolveHeldJob(params.data.jobId, {
      action: "reject",
      resolver,
      reason: body.data.reason,
    })
    return sendResolution(reply, params.data.jobId, "failed", result)
  })

  app.get("/v1/admin/review/decisions", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = decisionsQuery.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send(validationError(parsed.error.issues[0]?.message ?? "Invalid query"))
    }
    const { page, pageSize, jobId, policyId, verdict, hookPoint, since } = parsed.data

    let query = decisionsTable()
      // The log is a log. `held_objects` — any URL at all — is the one thing
      // the hold exists to keep out of circulation, so it is not selected and
      // not in the wire shape.
      .select("id, job_id, hook_point, policy_id, verdict, reason, resolver_email, created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(page * pageSize, (page + 1) * pageSize - 1)
    if (jobId) query = query.eq("job_id", jobId)
    if (policyId) query = query.eq("policy_id", policyId)
    if (verdict) query = query.eq("verdict", verdict)
    if (hookPoint) query = query.eq("hook_point", hookPoint)
    if (since) query = query.gte("created_at", since)

    const { data, error, count } = await query
    if (error) {
      req.log.error({ err: error }, "admin/review/decisions lookup failed")
      return reply.status(500).send({ error: { code: "internal_error", message: "Lookup failed" } })
    }
    const rows = (data ?? []) as unknown as DecisionRow[]
    return reply.send({ data: rows.map(toDecisionRow), total: count ?? rows.length, page, pageSize })
  })
}

// ---------------------------------------------------------------------------
// Result mapping — one table, so approve and reject cannot drift
// ---------------------------------------------------------------------------

type Resolution = Awaited<ReturnType<typeof resolveHeldJob>>

interface ReplyLike {
  status: (code: number) => ReplyLike
  send: (body: unknown) => unknown
}

function sendResolution(reply: ReplyLike, jobId: string, status: "completed" | "failed", result: Resolution) {
  if (result.ok) return reply.send({ ok: true, jobId, status })
  switch (result.reason) {
    case "not_found":
      return reply.status(404).send(NOT_FOUND)
    case "already_resolved":
      // NOT an error: another admin getting there first is a normal outcome,
      // and the page surfaces it as an info toast plus a refetch. The row's
      // current status rides along so the page can say what happened.
      return reply.status(409).send({
        error: {
          code: "review_already_resolved",
          message: "Another admin already resolved this job",
          ...(result.status ? { status: result.status } : {}),
        },
      })
    case "finalize_failed":
      // The job MUST remain `pending_review`: a half-completed hold is worse
      // than an unresolved one, and the reviewer can simply try again.
      return reply.status(502).send({
        error: { code: "finalize_failed", message: "The job could not be finished — it stays awaiting review" },
      })
    default: {
      // A `ReviewFailure` member added later is a COMPILE error here rather
      // than a handler that returns without sending — which would hang the
      // request until the browser gave up.
      const unhandled: never = result.reason
      return reply.status(500).send({
        error: { code: "internal_error", message: `Unhandled review result: ${String(unhandled)}` },
      })
    }
  }
}
