// @registry-enumerates prices the model identifiers it is given (getModelCreditBaseCost, CreditsService) — credit ids, not node types, so not a @registry-lookup
import { IMAGE_QUALITY_VALUES, IMAGE_RESOLUTION_VALUES } from "@nodaro/shared/models"
import type { FastifyInstance, FastifyRequest } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { insertJob } from "../lib/insert-job.js"
import { videoQueue } from "../lib/queue.js"
import { enqueueRouteJob } from "../lib/enqueue-route-job.js"
import { batchQueueId, runJobBatch } from "../lib/job-batch.js"
import { keyedBatchAnswer, keyedBatchJobsToPrice, keyedBatchReplay } from "../lib/keyed-batch-replay.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"
import { resolveEntityImageCreditIdentifier, resolveEntityImageParams } from "../lib/entity-credit-identifier.js"
import { applySnappedLevers } from "../lib/image-gen-normalize.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { withResolvedModel } from "../lib/job-resolved-model.js"
import { buildLocationPrompt, buildLocationRefinePrompt } from "@nodaro/prompts/doctrine"
import { formatZodError } from "../lib/zod-error.js"
import { hasCredits } from "../lib/config.js"
import { sendInternalError } from "../lib/http-errors.js"
import { IMAGE_MODEL_ROLE_DEFAULTS } from "@nodaro/shared/model-catalog"
import { providerRunModel } from "../lib/run-model.js"

const generateLocationBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  userPrompt: z.string().max(8000).optional(),
  category: z.enum(["indoor", "outdoor", "urban", "nature", "fantasy", "sci-fi", "historical", "futuristic", "other"]).optional(),
  // Free-text style (matches the entity save route + DB; a narrow enum would 400 inherited styles like "cinematic").
  style: z.string().max(50).optional(),
  sourceImageUrl: safeUrlSchema.optional(),
  provider: z.string().optional().default(IMAGE_MODEL_ROLE_DEFAULTS.general),
  // Credit-affecting output levers (mirrors generate-image). The enums are
  // PERMISSIVE on purpose — a value the chosen model doesn't support is never
  // 400d. It is SNAPPED to the model's catalog entry inside
  // `resolveEntityImageParams` (the resolver the CHECK and the DEBIT share) and
  // the snapped value is what gets recorded and enqueued, so an unsupported
  // lever no longer rides through to the provider.
  resolution: z.enum(IMAGE_RESOLUTION_VALUES).optional(),
  quality: z.enum(IMAGE_QUALITY_VALUES).optional(),
  userId: z.string().uuid().optional(),
  // Multi-candidate generation. `1` keeps the legacy single-job behavior and
  // response shape `{ jobId }`. `2`–`10` insert N jobs in parallel and return
  // `{ jobIds: string[] }`. Tasks 11+ wire the studio UI to render candidate
  // grids and prompt the user to pick a winner via
  // `POST /v1/locations/:id/approve-main-image`.
  count: z.number().int().min(1).max(10).optional().default(1),
  // Location Studio auto-attach: when set, the worker writes the resulting
  // image URL to `locations.main_image_url` on this row after generation
  // succeeds. Lets the studio survive page closes mid-generation.
  //
  // ⚠️ Only propagated to the job payload when `count === 1`. Multi-candidate
  // batches MUST go through explicit approval (`approve-main-image`) so the
  // user picks the winner — auto-attaching one of N candidates would leak a
  // random pick into the studio.
  attachToLocationId: z.string().uuid().optional(),
})

/**
 * Extract `count` from a raw request body for the credit pre-check.
 * The Zod schema isn't parsed yet at preHandler time, so we defensively
 * coerce and clamp to the allowed [1, 10] range. Invalid values fall back
 * to 1 so the pre-check never under-charges; the route's Zod validation
 * still 400s on bad input downstream.
 */
function extractCount(body: unknown): number {
  const raw = (body as { count?: unknown })?.count
  if (typeof raw !== "number" || !Number.isInteger(raw)) return 1
  if (raw < 1) return 1
  if (raw > 10) return 10
  return raw
}

/** The answer for several candidates: their jobs, in order (no `jobId` alias past count 1). */
function locationBatchAnswer(jobIds: readonly string[]): Record<string, unknown> {
  return { jobIds: [...jobIds] }
}

export async function generateLocationRoutes(app: FastifyInstance) {
  app.post(
    "/v1/generate-location",
    {
      // Multi-candidate batch: credits scale linearly with `count` (1–10).
      // Mirrors the generate-character pattern — without this, the preHandler
      // greenlights users who can afford ONE job even when count=10. computeCredits
      // returns BASE (pre-markup) credits; markup is applied inside creditGuardImpl
      // so the same final number is both checked AND reserved.
      // The identifier is quality/resolution-aware (composite ids like
      // "gpt-image:high") via the shared resolver — the SAME function the
      // handler's DEBIT uses, so the advisory CHECK can never price a
      // different tier than the reservation. `keyedBatchReplay` first: a
      // repeat of a keyed batch (count ≥ 2) is answered from its jobs before
      // any check, or priced for the jobs it still pays for.
      preHandler: [
        keyedBatchReplay({ size: extractCount, jobType: "generate-location", answer: locationBatchAnswer }),
        creditGuard((req: FastifyRequest) => resolveEntityImageCreditIdentifier(req.body), {
          runModel: providerRunModel(IMAGE_MODEL_ROLE_DEFAULTS.general),
          computeCredits: async (body, req) => {
            const count = keyedBatchJobsToPrice(req) ?? extractCount(body)
            const identifier = resolveEntityImageCreditIdentifier(body)
            // Dynamic import: getModelCreditBaseCost lives in ee/ and we keep
            // core free of static ee/ imports. Only reached in cloud edition
            // (creditGuard short-circuits to a no-op otherwise).
            const { getModelCreditBaseCost } = await import("../ee/billing/credits.js")
            const pricing = await getModelCreditBaseCost(identifier)
            return pricing.creditCost * count
          },
        }),
      ],
    },
    async (req, reply) => {
      const parsed = generateLocationBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "validation_error", ...formatZodError(parsed.error) },
        })
      }

      const { name, description, category, style, sourceImageUrl, userPrompt } = parsed.data
      const userId = req.userId

      if (!userId) {
        return reply.status(401).send({
          error: { code: "unauthorized", message: "Authentication required" },
        })
      }

      // Composite identifier (provider[:quality|:resolution|…]) — derived by
      // the SAME resolver the preHandler ran on the raw body, so CHECK===DEBIT.
      const entityParams = resolveEntityImageParams(parsed.data)
      const modelIdentifier = entityParams.identifier
      // Record and enqueue the levers this run was PRICED on. This body carries
      // no `aspectRatio` field, so there is nothing for the write-back to pin.
      applySnappedLevers(
        parsed.data,
        { resolution: entityParams.resolution, quality: entityParams.quality },
        generateLocationBody,
      )

      // Prompt building has two modes:
      //  - Refine/edit: when the caller supplies a non-empty `userPrompt` (the
      //    studio's "describe changes" / sparkle Edit flow), it is honored as a
      //    TRANSIENT edit instruction via buildLocationRefinePrompt. Paired with
      //    `sourceImageUrl` the worker runs i2i so the source establishing shot
      //    is edited toward the instruction. Crucially the instruction is NOT
      //    written back to the row (this route only image-only auto-attaches),
      //    so the stored name / description / canonicalDescription are untouched
      //    - that is the whole point of "transient". Previously `userPrompt` was
      //    accepted by the schema but silently dropped, which pushed callers to
      //    smuggle edits through `description` and risk polluting the stored copy.
      //  - From-scratch: no `userPrompt` -> build from the persisted scene
      //    fields exactly as before.
      const refineInstruction = userPrompt?.trim()
      const prompt = refineInstruction
        ? buildLocationRefinePrompt({ editPrompt: refineInstruction, style })
        : buildLocationPrompt({ name, description, category, style })

      const mcpClient = extractMcpClient(req.body)
      const workflowId = extractWorkflowId(req.body)
      const forcePrivate = extractForcePrivate(req.body) || undefined
      // The full body — minus attachToLocationId — is the base for every job's
      // input_data. Stripping attachToLocationId here means count=2/4 batches
      // never carry the attach id; we re-add it ONLY for the single-job
      // (count=1) backward-compat path below.
      const { attachToLocationId: _attachToLocationId, ...bodyWithoutAttach } = parsed.data
      const baseInputData = withResolvedModel(buildJobInputData(bodyWithoutAttach, "generate-location"), "generate-location")

      // Multi-candidate (count=2/4) strips `attachToLocationId` from input_data
      // so the worker doesn't auto-attach — the user must approve a winner
      // through `POST /v1/locations/:id/approve-main-image`. Single-candidate
      // (count=1) propagates it for backward compat with the existing
      // "instant attach" Studio flow.
      //
      // `attachToLocationId` (the auto-attach trigger) is propagated to
      // input_data ONLY for the single-candidate (count=1) "instant attach"
      // flow: the worker reads it from the QUEUE payload to write
      // source_image_url, and the count=1 main job also surfaces in the
      // location's pendingJobs via this field. Multi-candidate batches omit it
      // so no candidate auto-attaches; the user picks a winner via
      // approve-main-image.
      //
      // `candidateForLocationId` is the SEPARATE candidate-tracking key. It is
      // written for EVERY generation tied to a location (count=1 AND count>1)
      // and is NEVER read by any worker/reconcile auto-attach path - it exists
      // purely so GET /v1/locations/:id can surface completed candidates as
      // `previousCandidates` (the "pick from N / keep the original" strip). This
      // is why count>1 candidates are now findable WITHOUT re-introducing the
      // auto-attach risk that keeping `attachToLocationId` on them would carry.
      const attachId = parsed.data.attachToLocationId
      const includeAttach = parsed.data.count === 1 && attachId !== undefined
      const inputDataForInsert = {
        ...baseInputData,
        prompt,
        ...(attachId !== undefined ? { candidateForLocationId: attachId } : {}),
        ...(includeAttach ? { attachToLocationId: attachId } : {}),
      }
      const row = {
        workflow_id: workflowId,
        force_private: forcePrivate,
        user_id: userId,
        status: "pending",
        input_data: inputDataForInsert,
        ...(mcpClient ? { mcp_client: mcpClient } : {}),
      }
      // The worker's payload beside the job id and its usage log.
      // `attachToLocationId` rides it ONLY when count=1 (matches what's in
      // input_data — single source of truth).
      const queueData = {
        prompt,
        sourceImageUrl,
        provider: parsed.data.provider,
        resolution: parsed.data.resolution,
        quality: parsed.data.quality,
        ...(includeAttach ? { attachToLocationId: parsed.data.attachToLocationId } : {}),
      }

      // ──────────────────────────────────────────────────────────────────────
      // Per-job creditOverride correction: the preHandler priced the BATCH
      // total (cost×count×markup) into the override, and every reservation
      // reads it — without resetting it to the per-JOB marked-up cost, N jobs
      // would each debit the batch total (an N² over-charge).
      //
      // The per-job BASE is `getModelCreditBaseCost(modelIdentifier).creditCost`
      // — identical to what computeCredits uses (it multiplies that same base
      // by `count`), so per-job = computeCredits's base ÷ count. We then apply
      // the SAME markup formula creditGuardImpl uses so the final per-job
      // number matches what was checked.
      // ──────────────────────────────────────────────────────────────────────
      if (hasCredits() && req.creditReservation) {
        const { getModelCreditBaseCost } = await import("../ee/billing/credits.js")
        const pricing = await getModelCreditBaseCost(modelIdentifier)
        const { applyServiceMarkup } = await import("../ee/billing/service-margin.js")
        const { getAppSettings } = await import("../lib/app-settings.js")
        const settings = await getAppSettings()
        // Same helper (integer-domain rounding + per-service margin) that
        // creditGuardImpl and the anomaly detector's actual use, so the reserve
        // can never round a credit apart from them (no phantom credit_anomalies).
        req.creditReservation.creditOverride = applyServiceMarkup(pricing.creditCost, settings, modelIdentifier)
      }

      if (parsed.data.count === 1) {
        // One job: inserted, reserved (which writes the request's
        // Idempotency-Key onto it) and queued; a queue that refuses it fails
        // and refunds it (enqueueRouteJob). `jobIds` is ALWAYS present (the
        // harmonized contract — matches characters); `jobId` is a deprecated
        // back-compat alias kept for count===1 only.
        const { data: job, error } = await insertJob(req, row)
        if (error || !job) return sendInternalError(reply, req, error, "Failed to create job")
        const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
        if (reply.sent) return
        await enqueueRouteJob(req, reply, job.id, () =>
          videoQueue.add("generate-location", { jobId: job.id, ...queueData, usageLogId: reservation?.usageLogId }),
        )
        if (reply.sent) return
        return { jobId: job.id, jobIds: [job.id] }
      }

      // Several candidates: created, reserved and queued all or nothing by
      // `runJobBatch` (lib/job-batch.ts), each under its own Idempotency-Key
      // (`<key>:<i>`), so a repeat with the same key returns the same jobs and
      // starts only what is missing. A failure before the queue refunds and
      // removes what this request made; a queue that refuses the batch fails
      // and refunds the jobs it did not start and answers 500 naming the ones
      // that did (`error.startedJobIds`).
      const jobs = await runJobBatch(
        req,
        reply,
        Array.from({ length: parsed.data.count }, () => ({ row, creditIdentifier: modelIdentifier })),
        {
          idempotencyKey: req.idempotencyKey,
          failureMessage: "Failed to create jobs",
          // One call: the queue adds the whole list atomically, or none of it.
          enqueue: async (toQueue) => {
            await videoQueue.addBulk(toQueue.map((job) => ({
              name: "generate-location",
              data: { jobId: job.jobId, ...queueData, usageLogId: job.usageLogId },
              opts: { jobId: batchQueueId("generate-location", job.jobId) },
            })))
          },
        },
      )
      if (!jobs) return
      return keyedBatchAnswer(reply, jobs, locationBatchAnswer)
    },
  )
}
