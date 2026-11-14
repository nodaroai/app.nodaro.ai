// backend/src/routes/video-sfx.ts
// @registry-enumerates refunds a usage log through CreditsService — by usage, not by node type, so not a @registry-lookup
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { VIDEO_SFX_PRICING, videoSfxCreditId } from "@nodaro/shared/credits"
import { measureVideoSfxDuration } from "../lib/video-sfx-duration.js"
import { baseCreditCostFor } from "../lib/credit-base-cost.js"
import { safeUrlSchema } from "../lib/url-validator.js"
import { insertJob } from "../lib/insert-job.js"
import { applyPromptPolicies } from "../lib/prompt-policy.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { videoQueue } from "../lib/queue.js"
import { enqueueRouteJob } from "../lib/enqueue-route-job.js"
import { batchQueueId, runJobBatch } from "../lib/job-batch.js"
import { keyedBatchAnswer, keyedBatchJobsToPrice, keyedBatchReplay } from "../lib/keyed-batch-replay.js"
import { hasCredits } from "../lib/config.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"

const SEED_MAX = 2 ** 31 - 1

export const VideoSfxBody = z.object({
  // safeUrlSchema (not z.string().url()): rejects literal private/reserved IPs
  // and non-http(s) at the boundary. The DNS-rebinding case is closed at the
  // ffprobe sink by assertSafeProbeSource in ffmpeg-utils.ts.
  videoUrl: safeUrlSchema,
  prompt: z.string().max(2000).optional(),
  negativePrompt: z.string().max(500).optional().default("music"),
  cfgStrength: z.number().min(1).max(10).optional().default(4.5),
  numSteps: z.number().int().min(10).max(50).optional().default(25),
  seed: z.number().int().optional(),
  versions: z.number().int().min(1).max(4).optional().default(1),
})
export type VideoSfxBody = z.infer<typeof VideoSfxBody>

/**
 * Fastify preHandler: measures the input video by the rule the workflow run
 * shares (`measureVideoSfxDuration`: 8 s when the probe fails, 400 for a
 * zero-length or over-300 s video), stashes ceil(duration) on
 * req.probedDuration AND mirrors it on req.body.__probedDuration so the credit
 * guard (which only sees the body) prices the right row without re-probing.
 */
export async function probeDurationPreHandler(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = req.body as VideoSfxBody
  const measured = await measureVideoSfxDuration(body.videoUrl, (err) => {
    req.log.warn({ err }, "video-sfx: ffprobe failed; falling back to 8s bucket")
  })
  if (!measured.ok) {
    return void reply.code(400).send({ error: measured.code, message: measured.message })
  }
  req.probedDuration = measured.durationSec
  ;(req.body as Record<string, unknown>).__probedDuration = measured.durationSec
}

/** How many versions the raw body asks for (1–4), read before validation like the price check. */
function requestedVersions(body: unknown): number {
  const raw = (body as Record<string, unknown> | undefined)?.versions
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 1 ? Math.min(raw, 4) : 1
}

/** The answer for several versions: their jobs, in order. */
function videoSfxBatchAnswer(jobIds: readonly string[]): Record<string, unknown> {
  return { jobIds: [...jobIds] }
}

/** The price row for the length the preHandler measured. */
function probedCreditId(body: unknown): string {
  const probed = (body as Record<string, unknown> | undefined)?.__probedDuration
  return videoSfxCreditId(typeof probed === "number" ? probed : undefined)
}

export default async function videoSfxRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/video-sfx", {
    preHandler: [
      // A repeat of a keyed batch (versions ≥ 2) is answered from its jobs
      // before the probe and any check, or priced for the jobs it still pays
      // for (lib/keyed-batch-replay.ts).
      keyedBatchReplay({ size: requestedVersions, jobType: "video-sfx", answer: videoSfxBatchAnswer }),
      probeDurationPreHandler,
      // Priced from the length's own row (`replicate-mmaudio:<n>s`, the
      // admin-editable model_pricing row over the static table), the same row
      // a workflow run reserves for this clip.
      //
      // Multi-version batch: credits scale linearly with `versions` (1-4).
      // Without `× versions` the preHandler would greenlight users who can
      // afford ONE generation when versions=4 — then Phase 2A would partially
      // reserve, fail mid-batch, and roll back. Checking the batch up front
      // is cheaper UX. Mirrors generate-object / generate-character /
      // generate-location. computeCredits returns BASE; markup is applied
      // inside creditGuardImpl so checkCredits + reserveCredits agree on
      // the final number.
      creditGuard(
        (req) => probedCreditId(req.body),
        {
          computeCredits: async (parsedBody, req) => {
            const versions = keyedBatchJobsToPrice(req) ?? requestedVersions(parsedBody)
            return (await baseCreditCostFor(probedCreditId(parsedBody))) * versions
          },
        },
      ),
    ],
  }, async (req, reply) => {
    // Manual Zod parse — preHandler ran first against raw body (it only reads videoUrl).
    // Strip the preHandler-stashed __probedDuration before parsing so it doesn't leak through.
    const rawBody = (req.body ?? {}) as Record<string, unknown>
    const { __probedDuration: _stashed, ...toParse } = rawBody
    const parsed = VideoSfxBody.safeParse(toParse)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }
    const body = parsed.data
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    // B4b: deployment prompt policy at this route's assembly point (kind
    // "audio" — the SFX description is a generative prompt). Only when a
    // prompt exists; written back onto `body` so every per-version inputData
    // and the queue payloads below carry the policed text. No policy
    // registered = identity.
    if (body.prompt) {
      const policed = applyPromptPolicies({ prompt: body.prompt, negativePrompt: body.negativePrompt ?? "", kind: "audio" })
      body.prompt = policed.prompt
      body.negativePrompt = policed.negativePrompt
    }

    const duration = req.probedDuration ?? VIDEO_SFX_PRICING.FALLBACK_DURATION_SEC
    const versions = body.versions
    const bucketKey = videoSfxCreditId(duration)

    const mcpClient = extractMcpClient(req.body)
    const workflowId = extractWorkflowId(req.body)
    const forcePrivate = extractForcePrivate(req.body) || undefined

    // ──────────────────────────────────────────────────────────────────────
    // Per-row credit override.
    //
    // creditGuardImpl set `req.creditReservation.creditOverride` to the
    // BATCH total (bucketBase × versions × markup) so the upfront affordance
    // check above is correct. But reserveCreditsForJobImpl reads the SAME
    // `req.creditReservation.creditOverride` for EVERY per-row reservation
    // call — without correction, each of N rows would be deducted the batch
    // total (N² over-charge). So it is set to the per-ROW figure before any
    // row is reserved.
    //
    // ⚠️ Subtlety: the override is consumed by `reserveCredits` as the
    // final p_credits value (post-markup), NOT as a pre-markup BASE. So
    // mirror what creditGuardImpl computed: apply the SAME markup formula
    // to the per-job base. We re-fetch app settings via the dynamic ee
    // import path keep this file ee-import-free. (hasCredits() guard.)
    // ──────────────────────────────────────────────────────────────────────
    if (hasCredits() && req.creditReservation) {
      const baseCredits = await baseCreditCostFor(bucketKey)
      const { applyServiceMarkup } = await import("../ee/billing/service-margin.js")
      const { getAppSettings } = await import("../lib/app-settings.js")
      const settings = await getAppSettings()
      // Same helper (integer-domain rounding + per-service margin) creditGuardImpl
      // and the anomaly detector's actual use for the bucket row, so the
      // reserve can never round a credit apart from them (no phantom anomaly).
      req.creditReservation.creditOverride = applyServiceMarkup(baseCredits, settings, bucketKey)
    }

    // ──────────────────────────────────────────────────────────────────────
    // One row per version. Each carries its own seed (sequential when
    // user-supplied, -1 otherwise) + per-iteration index so the worker can
    // identify which version of the batch it is.
    //
    // Worker reads canonical fields (videoUrl, prompt, etc.) from the
    // jobs row's input_data (single source of truth), but we still pass
    // them in the BullMQ payload for parity with the rest of the worker
    // pipeline and to avoid a second DB read on hot path.
    // ──────────────────────────────────────────────────────────────────────
    const planned = Array.from({ length: versions }, (_, i) => {
      const seedForVersion = (body.seed !== undefined && body.seed >= 0)
        ? (body.seed + i) % SEED_MAX
        : -1
      const inputData = {
        type: "video-sfx",
        videoUrl: body.videoUrl,
        prompt: body.prompt,
        negativePrompt: body.negativePrompt,
        cfgStrength: body.cfgStrength,
        numSteps: body.numSteps,
        seed: seedForVersion,
        duration_seconds: duration,
        bucketKey,
        iterationIndex: i,
        iterationTotal: versions,
      }
      return {
        row: {
          user_id: userId,
          status: "pending",
          input_data: inputData,
          ...(workflowId ? { workflow_id: workflowId } : {}),
          ...(forcePrivate !== undefined ? { force_private: forcePrivate } : {}),
          ...(mcpClient ? { mcp_client: mcpClient } : {}),
        },
        queueData: { userId, model: "replicate-mmaudio", ...inputData },
      }
    })
    // The payload carries the input's fields but not its `type` (the job name says it).
    const payloadOf = (i: number, jobId: string, usageLogId: string | undefined) => {
      const { type: _type, ...fields } = planned[i]!.queueData
      return { jobId, ...fields, usageLogId }
    }

    if (versions === 1) {
      // One version: inserted, reserved (which writes the request's
      // Idempotency-Key onto it) and queued; a queue that refuses it fails and
      // refunds it (enqueueRouteJob). The legacy `{ jobId }` answer.
      const { data: job, error } = await insertJob(req, planned[0]!.row)
      if (error || !job) return sendInternalError(reply, req, error, "Failed to create job")
      const reservation = await reserveCreditsForJob(req, reply, job.id, bucketKey)
      if (reply.sent) return
      await enqueueRouteJob(req, reply, job.id, () => videoQueue.add("video-sfx", payloadOf(0, job.id, reservation?.usageLogId)))
      if (reply.sent) return
      return { jobId: job.id }
    }

    // Several versions: created, reserved and queued all or nothing by
    // `runJobBatch` (lib/job-batch.ts), each under its own Idempotency-Key
    // (`<key>:<i>`), so a repeat with the same key returns the same jobs and
    // starts only what is missing. A failure before the queue refunds and
    // removes what this request made; a queue that refuses the batch fails and
    // refunds the versions it did not start and answers 500 naming the ones
    // that did (`error.startedJobIds`). Answered `{ jobIds }`, matching
    // generate-object's contract.
    const jobs = await runJobBatch(
      req,
      reply,
      planned.map((p) => ({ row: p.row, creditIdentifier: bucketKey })),
      {
        idempotencyKey: req.idempotencyKey,
        failureMessage: "Failed to create jobs",
        // One call: the queue adds the whole list atomically, or none of it.
        enqueue: async (toQueue) => {
          await videoQueue.addBulk(toQueue.map((job) => ({
            name: "video-sfx",
            data: payloadOf(job.index, job.jobId, job.usageLogId),
            opts: { jobId: batchQueueId("video-sfx", job.jobId) },
          })))
        },
      },
    )
    if (!jobs) return
    return keyedBatchAnswer(reply, jobs, videoSfxBatchAnswer)
  })
}
