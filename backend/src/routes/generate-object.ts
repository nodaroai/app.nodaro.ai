// @registry-enumerates prices the model identifiers it is given (getModelCreditBaseCost, CreditsService) — credit ids, not node types, so not a @registry-lookup
import type { FastifyInstance, FastifyRequest } from "fastify"
import { z } from "zod"
import { expectedUpdatedAtSchema } from "../lib/optimistic-token-schema.js"
import { safeUrlSchema } from "../lib/url-validator.js"
import { insertJob } from "../lib/insert-job.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { enqueueRouteJob } from "../lib/enqueue-route-job.js"
import { batchQueueId, runJobBatch } from "../lib/job-batch.js"
import { keyedBatchAnswer, keyedBatchJobsToPrice, keyedBatchReplay } from "../lib/keyed-batch-replay.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { plainEntityCheckIdentifier, plainEntityCreditIdentifier } from "../lib/entity-credit-identifier.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { withResolvedModel } from "../lib/job-resolved-model.js"
import { resolveEntityAspect } from "@nodaro/shared/entities"
import { buildObjectPrompt } from "@nodaro/prompts/doctrine"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { hasCredits } from "../lib/config.js"
import { IMAGE_MODEL_ROLE_DEFAULTS } from "@nodaro/shared/model-catalog"
import { providerRunModel } from "../lib/run-model.js"

const generateObjectBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  userPrompt: z.string().max(8000).optional(),
  category: z.enum(["furniture", "vehicle", "weapon", "food", "clothing", "electronics", "nature", "tool", "animal", "other"]).optional(),
  // Free-text style (matches the entity save route + DB; a narrow enum would 400 inherited styles like "cinematic").
  style: z.string().max(50).optional(),
  sourceImageUrl: safeUrlSchema.optional(),
  provider: z.string().optional().default(IMAGE_MODEL_ROLE_DEFAULTS.general),
  userId: z.string().uuid().optional(),
  // Multi-candidate generation. `1` keeps the legacy single-job behavior and
  // response shape `{ jobId }`. `2`–`10` insert N jobs in parallel and return
  // `{ jobIds: string[] }`. Object Studio renders candidate grids and prompts
  // the user to pick a winner via `POST /v1/objects/:id/approve-main-image`.
  count: z.number().int().min(1).max(10).optional().default(1),
  // Object Studio auto-attach: when set, the worker writes the resulting
  // image URL to `objects.source_image_url` on this row after generation
  // succeeds. Lets the studio survive page closes mid-generation.
  //
  // ⚠️ Only propagated to the job payload when `count === 1`. Multi-candidate
  // batches MUST go through explicit approval (`approve-main-image`) so the
  // user picks the winner — auto-attaching one of N candidates would leak a
  // random pick into the studio.
  attachToObjectId: z.string().uuid().optional(),
  // Phase E picker-hint pass-through: when the user picks an object from the
  // catalog (parameter-picker), the seed prompt fragment flows through to
  // the worker so it can be appended to the prompt context.
  seedPromptHint: z.string().max(2000).optional(),
  // Optional name to set on the attached row at the same time as the
  // source image URL (worker auto-attach helper writes both atomically).
  attachName: z.string().max(100).optional(),
  // Optimistic-concurrency guard for the single-candidate auto-attach path:
  // if set, worker bails on attach when `objects.updated_at` has drifted.
  expectedUpdatedAt: expectedUpdatedAtSchema,
  // Optional explicit aspect override ("W:H") for the main object image.
  // Permissive — `resolveEntityAspect` validates the format and falls through
  // to the default when absent/malformed. Explicit wins over the default.
  aspectRatio: z.string().max(16).optional(),
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
function objectBatchAnswer(jobIds: readonly string[]): Record<string, unknown> {
  return { jobIds: [...jobIds] }
}

export async function generateObjectRoutes(app: FastifyInstance) {
  app.post(
    "/v1/generate-object",
    {
      // Multi-candidate batch: credits scale linearly with `count` (1–10).
      // Mirrors the generate-location / generate-character pattern — without
      // this, the preHandler greenlights users who can afford ONE job even
      // when count=10. computeCredits returns BASE (pre-markup) credits;
      // markup is applied inside creditGuardImpl so the same final number
      // is both checked AND reserved. `keyedBatchReplay` first: a repeat of a
      // keyed batch (count ≥ 2) is answered from its jobs before any check, or
      // priced for the jobs it still pays for.
      preHandler: [
        keyedBatchReplay({ size: extractCount, jobType: "generate-object", answer: objectBatchAnswer }),
        creditGuard((req: FastifyRequest) => plainEntityCheckIdentifier(req.body, IMAGE_MODEL_ROLE_DEFAULTS.general), {
          runModel: providerRunModel(IMAGE_MODEL_ROLE_DEFAULTS.general),
          computeCredits: async (body, req) => {
            const count = keyedBatchJobsToPrice(req) ?? extractCount(body)
            const identifier = plainEntityCheckIdentifier(body, IMAGE_MODEL_ROLE_DEFAULTS.general)
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
      const parsed = generateObjectBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "validation_error", ...formatZodError(parsed.error) },
        })
      }

      const { name, description, category, style, sourceImageUrl } = parsed.data
      const userId = req.userId

      if (!userId) {
        return reply.status(401).send({
          error: { code: "unauthorized", message: "Authentication required" },
        })
      }

      // ─────────────────────────────────────────────────────────────────────
      // Ownership pre-check on the attach target (spec Pass 3 F-30: MUST
      // happen BEFORE reserveCreditsForJob so a forged `attachToObjectId`
      // can't burn credits before the check). Service-role bypasses RLS,
      // so without this re-check a forged id would let the worker write
      // to another user's row. Also rejects soft-deleted rows.
      //
      // Per spec Pass 10 F-90b: object uses a uniform `"not_found"` error
      // code for missing/cross-user/soft-deleted rows (object is
      // DELIBERATELY stricter than location's per-path codes to prevent
      // callees from enumerating object IDs by error-code differences).
      // ─────────────────────────────────────────────────────────────────────
      if (parsed.data.attachToObjectId) {
        const { data: own } = await supabase
          .from("objects")
          .select("id")
          .eq("id", parsed.data.attachToObjectId)
          .eq("user_id", userId)
          .is("deleted_at", null)
          .maybeSingle()
        if (!own) {
          return reply.status(404).send({
            error: { code: "not_found", message: "Object not found" },
          })
        }
      }

      const modelIdentifier = plainEntityCreditIdentifier(parsed.data.provider, sourceImageUrl ? 1 : 0)

      const prompt = buildObjectPrompt({ name, description, category, style })

      // Main object image: square product-shot framing (1:1) — the canonical
      // turnaround reference. Mirrors generate-character.ts's main-image aspect
      // resolution; the worker forwards this as the provider `aspect_ratio`
      // (clamped to the model). Explicit caller value wins over the default.
      const aspectRatio = resolveEntityAspect({
        entity: "object",
        assetType: "angles",
        explicit: parsed.data.aspectRatio,
      })

      const mcpClient = extractMcpClient(req.body)
      const workflowId = extractWorkflowId(req.body)
      const forcePrivate = extractForcePrivate(req.body) || undefined

      // The full body — minus attachToObjectId / attachName / expectedUpdatedAt —
      // is the base for every job's input_data. Stripping these here means
      // count=2/4 batches never carry the attach metadata; we re-add it ONLY
      // for the single-job (count=1) backward-compat path below.
      const {
        attachToObjectId: _attachToObjectId,
        attachName: _attachName,
        expectedUpdatedAt: _expectedUpdatedAt,
        ...bodyWithoutAttach
      } = parsed.data
      const baseInputData = withResolvedModel(buildJobInputData(bodyWithoutAttach, "generate-object"), "generate-object")

      // Multi-candidate (count=2/4) strips `attachToObjectId` from input_data
      // so the worker doesn't auto-attach — the user must approve a winner
      // through `POST /v1/objects/:id/approve-main-image`. Single-candidate
      // (count=1) propagates it for backward compat with the existing
      // "instant attach" Studio flow.
      const includeAttach = parsed.data.count === 1 && parsed.data.attachToObjectId !== undefined
      const inputDataForInsert = includeAttach
        ? {
            ...baseInputData,
            attachToObjectId: parsed.data.attachToObjectId,
            attachName: parsed.data.attachName,
            expectedUpdatedAt: parsed.data.expectedUpdatedAt,
            prompt,
          }
        : { ...baseInputData, prompt }
      const row = {
        workflow_id: workflowId,
        force_private: forcePrivate,
        user_id: userId,
        status: "pending",
        input_data: inputDataForInsert,
        ...(mcpClient ? { mcp_client: mcpClient } : {}),
      }
      // The worker's payload beside the job id and its usage log.
      // `attachToObjectId` + auto-attach metadata rides it ONLY when count=1
      // (matches what's in input_data — single source of truth).
      const queueData = {
        prompt,
        sourceImageUrl,
        provider: parsed.data.provider,
        aspectRatio,
        seedPromptHint: parsed.data.seedPromptHint,
        ...(includeAttach
          ? {
              attachToObjectId: parsed.data.attachToObjectId,
              attachName: parsed.data.attachName,
              expectedUpdatedAt: parsed.data.expectedUpdatedAt,
            }
          : {}),
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
          videoQueue.add("generate-object", { jobId: job.id, ...queueData, usageLogId: reservation?.usageLogId }),
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
              name: "generate-object",
              data: { jobId: job.jobId, ...queueData, usageLogId: job.usageLogId },
              opts: { jobId: batchQueueId("generate-object", job.jobId) },
            })))
          },
        },
      )
      if (!jobs) return
      return keyedBatchAnswer(reply, jobs, objectBatchAnswer)
    },
  )
}
