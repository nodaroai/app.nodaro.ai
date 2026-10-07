import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import {
  COLLECTION_DEDUPE_KEY_MAX,
  COLLECTION_MEDIA_TYPES,
  COLLECTION_RECORD_MEDIA_MAX,
  COLLECTION_RECORD_TEXT_MAX,
  COLLECTION_RECORD_TITLE_MAX,
  COLLECTION_RECORD_URL_MAX,
  COLLECTION_READ_LIMIT_MAX,
  COLLECTION_READ_WINDOW_HOURS_MAX,
  isCollectionUrl,
  collectionRecordHeadline,
  collectionRecordsDigest,
  collectionReadSince,
  type CollectionDigestFormat,
  type CollectionRecord,
  type CollectionRecordSource,
} from "@nodaro/shared"
import { sendInternalError } from "../lib/http-errors.js"
import { insertJob } from "../lib/insert-job.js"
import { markJobFailed } from "../lib/job-failure.js"
import { requireAppScope } from "../lib/scope-prehandler.js"
import { markJobCompleted } from "../workers/shared.js"
import { creditGuard } from "../middleware/credit-guard.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { extractNodeId, extractWorkflowId } from "../lib/request-helpers.js"
import { findCollection, readRecordsPage, toRecord, writeCollectionRecord } from "../lib/collections-store.js"

/**
 * The two collection nodes' routes — sync-HTTP, called by the editor's Run and
 * by the orchestrator alike (`SYNC_HTTP_ROUTES`), over the same store as the
 * API (`lib/collections-store.ts`). Both are free (`creditGuard` with
 * `checkOnly` keeps the edition and account gates, reserves nothing) and
 * answer through a `jobs` row so a run's history shows them.
 *
 * Save to Collection (`POST /v1/collection-write`): one record per call —
 * the item the node received (JSON text from a `json` wire, or plain text),
 * the mapped title / text / link / dedupe key, the picture and video wired
 * in. The orchestrator sends an `Idempotency-Key` per execution + node (+
 * fan-out iteration), so a re-pick saves once (`replayed`); the same link
 * twice is one record (`duplicate`) — neither is a failure.
 *
 * Read Collection (`POST /v1/collection-read`): the records saved in the last
 * N hours / days, newest or oldest first, up to `limit`; `json` carries the
 * records, `listResults` one per record (an "each" wire), `text` the digest
 * (`headlines` or `full`). A window with nothing in it answers `text: ""`, so
 * a text-requiring node behind it is skipped and the run ends "nothing new"
 * — the dedupe path of a scheduled pipeline.
 *
 * `output_data` MUST carry the text: returning a `jobId` routes the
 * orchestrator down its job-polling branch, where the node's output is rebuilt
 * from the jobs row (`buildNodeOutputFromJobData`).
 */

const linkSchema = z.string().max(COLLECTION_RECORD_URL_MAX)
const writeBody = z.object({
  collectionId: z.string().uuid(),
  /** What the node received on `in`: any JSON, or JSON / plain text. */
  item: z.unknown().optional(),
  title: z.string().max(COLLECTION_RECORD_TITLE_MAX).optional(),
  text: z.string().max(COLLECTION_RECORD_TEXT_MAX).optional(),
  /** The node's link field is named `link` (the Copilot's deny-list locks node-data keys ending in url). */
  link: linkSchema.optional(),
  // A medium that is not an address is DROPPED by the store (`normalizeCollectionMedia`),
  // never a 400 for the whole item: a fan-out guess can put a post's JSON into imageUrl.
  media: z
    .array(z.object({ type: z.enum(COLLECTION_MEDIA_TYPES), url: z.string(), posterUrl: z.string().nullish() }))
    .max(COLLECTION_RECORD_MEDIA_MAX)
    .optional(),
  fields: z.record(z.string().min(1).max(100), z.union([z.string(), z.number(), z.boolean()])).optional(),
  dedupeKey: z.string().max(COLLECTION_DEDUPE_KEY_MAX).optional(),
  executionId: z.string().max(120).optional(),
})

const WINDOW_DAYS_MAX = COLLECTION_READ_WINDOW_HOURS_MAX / 24
const readBody = z
  .object({
    collectionId: z.string().uuid(),
    windowAmount: z.coerce.number().int().min(1).max(COLLECTION_READ_WINDOW_HOURS_MAX).default(24),
    windowUnit: z.enum(["hours", "days"]).default("hours"),
    limit: z.coerce.number().int().min(1).max(COLLECTION_READ_LIMIT_MAX).default(50),
    order: z.enum(["newest", "oldest"]).default("newest"),
    textFormat: z.enum(["headlines", "full"]).default("headlines"),
  })
  // The window is at most 30 days whichever unit names it — refused, never silently clamped.
  .refine((b) => b.windowUnit !== "days" || b.windowAmount <= WINDOW_DAYS_MAX, {
    message: `windowAmount: at most ${WINDOW_DAYS_MAX} days`,
    path: ["windowAmount"],
  })

const NOT_AVAILABLE_MESSAGE = "Collections are not available on this server yet."
const NOT_YOURS_MESSAGE = "That collection does not exist (or is not yours). Pick a collection in the node's settings."
/** Provenance written on a record (`source`) is bounded like the API bounds it. */
const PROVENANCE_MAX = 120

function unauthorized(reply: FastifyReply) {
  return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
}

function notAvailableOrNotYours(reply: FastifyReply, missingTable: boolean | undefined) {
  return missingTable
    ? reply.status(503).send({ error: { code: "not_available", message: NOT_AVAILABLE_MESSAGE } })
    : reply.status(404).send({ error: { code: "not_found", message: NOT_YOURS_MESSAGE } })
}

function idempotencyKeyOf(req: FastifyRequest): string | null {
  const raw = req.headers["idempotency-key"]
  const value = Array.isArray(raw) ? raw[0] : raw
  if (value === undefined) return null
  const key = String(value).trim()
  return key.length > 0 && key.length <= 200 ? key : null
}

/** The record as the node's `json` handle and the run's history carry it. */
function writeOutput(record: CollectionRecord, outcome: "inserted" | "duplicate" | "replayed", evicted: number, collectionName: string) {
  const headline = collectionRecordHeadline(record)
  return {
    json: record,
    text: headline,
    generatedText: headline,
    recordId: record.id,
    outcome,
    evicted,
    collectionName,
  }
}

/**
 * The row fails through the one funnel (lib/job-failure.ts): its CAS leaves a
 * row under review alone, and `error_message` is what the orchestrator shows
 * on the node. The message is plain — never a provider or database error.
 */
async function failJob(jobId: string, message: string) {
  await markJobFailed(jobId, { error_message: message })
}

/**
 * The per-minute limit on the two node routes (#1890). They are run lanes:
 * the editor's Run (a person's session) and the orchestrator (the internal
 * secret) call them once per item of a fan-out, so a cap there would fail a
 * long run halfway. A direct caller with an API token or an app token, the
 * credentials the Collections API limits, gets that API's record rate per
 * credential, so these routes are not a way around it. The limiter runs
 * before auth, so it reads the credential's shape. A forged `ndr_` token is
 * limited and then refused, and any other forged header is refused by auth.
 */
const MACHINE_CREDENTIAL = /^Bearer ndr_/
function machineCredentialLimit(max: number) {
  return {
    rateLimit: {
      max,
      timeWindow: "1 minute",
      allowList: (req: FastifyRequest) => !MACHINE_CREDENTIAL.test(req.headers.authorization ?? ""),
    },
  }
}

export async function collectionNodeRoutes(app: FastifyInstance): Promise<void> {
  // Save to Collection — 0 credits; the guard keeps the account gates and reserves nothing.
  // The same scope the Collections API asks of an app token for a record write;
  // the orchestrator's internal calls carry no app token and pass through.
  // A text record is not media, so the media storage quota does not apply.
  app.post("/v1/collection-write", {
    config: machineCredentialLimit(120),
    preHandler: [requireAppScope("assets:write"), creditGuard(() => "collection-write", { checkOnly: true, skipStorageCheck: true })],
  }, async (req, reply) => {
    const userId = req.userId
    if (!userId) return unauthorized(reply)
    const body = req.body as Record<string, unknown>
    const parsed = writeBody.safeParse(body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: parsed.error.issues[0]?.message ?? "invalid request" } })
    }
    const workflowId = extractWorkflowId(body)
    const nodeId = extractNodeId(body)
    const { collectionId, link, executionId, ...rest } = parsed.data

    // Ownership before anything else: a probe of someone else's collection id
    // leaves no job row behind, and the item is never looked at.
    const found = await findCollection(collectionId, userId)
    if (found.missingTable || found.error || !found.row) {
      if (found.error) return sendInternalError(reply, req, found.error, "Failed to save the record")
      return notAvailableOrNotYours(reply, found.missingTable)
    }

    const { data: job, error: jobErr } = await insertJob(req, {
      user_id: userId,
      workflow_id: workflowId || null,
      node_id: nodeId || null,
      status: "processing",
      input_data: buildJobInputData({ collectionId, title: rest.title, link, dedupeKey: rest.dedupeKey }, "collection-write"),
      provider: "collection-write",
      job_type: "collection-write",
    })
    if (jobErr || !job) return sendInternalError(reply, req, jobErr, "Failed to create job")

    const source: CollectionRecordSource = {
      via: "node",
      nodeType: "collection-write",
      ...(workflowId ? { workflowId: workflowId.slice(0, PROVENANCE_MAX) } : {}),
      ...(executionId ? { executionId } : {}),
      ...(nodeId ? { nodeId: nodeId.slice(0, PROVENANCE_MAX) } : {}),
    }
    const outcome = await writeCollectionRecord(req, {
      userId,
      collectionId,
      input: { ...rest, url: link },
      idempotencyKey: idempotencyKeyOf(req),
      source,
    })

    if (outcome.kind === "inserted" || outcome.kind === "duplicate" || outcome.kind === "replayed") {
      const evicted = outcome.kind === "inserted" ? outcome.evicted : 0
      const output = writeOutput(outcome.record, outcome.kind, evicted, outcome.collection.name)
      // Through the completion funnel (workers/shared.ts): the result gate sees
      // the output like any other job's, and the CAS flips only a live row.
      await markJobCompleted(job.id, { output_data: output })
      return { jobId: job.id, record: outcome.record, outcome: outcome.kind, evicted, collection: outcome.collection }
    }

    const message =
      outcome.kind === "not_found"
        ? NOT_YOURS_MESSAGE
        : outcome.kind === "missing_table"
          ? NOT_AVAILABLE_MESSAGE
          : outcome.kind === "empty"
            ? "Nothing to save: the record needs a title, a text, a link or a picture."
            : outcome.kind === "conflict"
              ? "The record changed while saving. Run again."
              : "Failed to save the record"
    await failJob(job.id, message)
    if (outcome.kind === "error") return sendInternalError(reply, req, outcome.error, "Failed to save the record")
    const status = outcome.kind === "missing_table" ? 503 : outcome.kind === "conflict" ? 409 : outcome.kind === "not_found" ? 404 : 400
    const code = outcome.kind === "missing_table" ? "not_available" : outcome.kind === "conflict" ? "conflict" : outcome.kind === "not_found" ? "not_found" : "empty_record"
    return reply.status(status).send({ error: { code, message } })
  })

  // Read Collection — 0 credits. It reads text records, so no storage quota either.
  app.post("/v1/collection-read", {
    config: machineCredentialLimit(120),
    preHandler: [requireAppScope("assets:read"), creditGuard(() => "collection-read", { checkOnly: true, skipStorageCheck: true })],
  }, async (req, reply) => {
    const userId = req.userId
    if (!userId) return unauthorized(reply)
    const body = req.body as Record<string, unknown>
    const parsed = readBody.safeParse(body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: parsed.error.issues[0]?.message ?? "invalid request" } })
    }
    const workflowId = extractWorkflowId(body)
    const nodeId = extractNodeId(body)
    const { collectionId, windowAmount, windowUnit, limit, order, textFormat } = parsed.data

    // Ownership first — no job row for a collection that is not the caller's.
    const found = await findCollection(collectionId, userId)
    if (found.missingTable || found.error || !found.row) {
      if (found.error) return sendInternalError(reply, req, found.error, "Failed to read the collection")
      return notAvailableOrNotYours(reply, found.missingTable)
    }

    const { data: job, error: jobErr } = await insertJob(req, {
      user_id: userId,
      workflow_id: workflowId || null,
      node_id: nodeId || null,
      status: "processing",
      input_data: buildJobInputData(parsed.data, "collection-read"),
      provider: "collection-read",
      job_type: "collection-read",
    })
    if (jobErr || !job) return sendInternalError(reply, req, jobErr, "Failed to create job")

    const since = collectionReadSince(windowAmount, windowUnit)
    const page = await readRecordsPage({ collectionId, userId, since, limit, order })
    if (page.error) {
      await failJob(job.id, "Failed to read the collection")
      return sendInternalError(reply, req, page.error, "Failed to read the collection")
    }
    const records = page.rows.map(toRecord)
    const text = collectionRecordsDigest(records, textFormat as CollectionDigestFormat)
    // `listResults` is NOT stored: the job-row reader derives it from `json`
    // (`buildNodeOutputFromJobData`), and a third copy of 200 full records
    // would sit in every run's node_states.
    const output = {
      json: records,
      text,
      generatedText: text,
      count: records.length,
      since,
      collectionName: found.row.name,
    }
    await markJobCompleted(job.id, { output_data: output })
    return { jobId: job.id, records, text, count: records.length, since, collection: found.row }
  })
}

/** The two request schemas, for the orchestrator dispatch test (the body a graph run posts must be one the route accepts). */
export { writeBody as collectionWriteBody, readBody as collectionReadBody }
