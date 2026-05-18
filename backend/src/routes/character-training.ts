/**
 * Character LoRA training routes (Cloud edition only).
 *
 * POST   /v1/characters/:id/train     — start training
 * GET    /v1/characters/:id/training  — poll status
 * DELETE /v1/characters/:id/lora      — tear down LoRA
 *
 * Auth: ownership-by-`req.userId` only — matches existing routes/characters.ts
 * pattern (no scope check; the `characters:*` scopes don't exist).
 *
 * Race safety: atomic CAS slot claim on the row before any work happens.
 * Failure safety: every step inside a try/catch that rolls back the CAS,
 * cleans up R2 zip, refunds credits, marks the job failed. Pass 3/4/5/6
 * audit findings are inlined.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { hasCredits, config } from "../lib/config.js"
import { supabase } from "../lib/supabase.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { formatZodError } from "../lib/zod-error.js"
import { deleteFromR2 } from "../lib/storage.js"
import {
  collectTrainingImages,
  zipImagesToR2Buffer,
  buildTriggerWord,
  refundReservedCreditsForJob,
  InsufficientImagesError,
} from "../lib/character-lora.js"
import {
  createCharacterTraining,
  cancelCharacterTraining,
  deleteCharacterLora,
} from "../providers/replicate/training.js"

const idParams = z.object({ id: z.string().uuid() })
const TRAINING_CREDIT_ID = "character-lora-training"

export async function characterTrainingRoutes(app: FastifyInstance): Promise<void> {
  if (!hasCredits()) return

  // ────────────────────────────────────────────────────────────────────────
  // POST /v1/characters/:id/train
  // ────────────────────────────────────────────────────────────────────────
  app.post(
    "/v1/characters/:id/train",
    {
      // Pass 3 catch — without rate-limit a stolen JWT could burn 150cr×N.
      config: { rateLimit: { max: 3, timeWindow: "1m" } },
      preHandler: creditGuard(() => TRAINING_CREDIT_ID),
    },
    async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
      // Pre-flight — Pass 5 catches.
      if (!req.userId) {
        reply.code(401).send({ error: "unauthorized" })
        return
      }
      if (!config.PUBLIC_URL) {
        reply.code(503).send({ error: "public_url_not_configured" })
        return
      }

      const params = idParams.safeParse(req.params)
      if (!params.success) {
        reply.code(400).send(formatZodError(params.error))
        return
      }
      const characterId = params.data.id

      // Step 0 — atomic CAS slot claim. `.or()` because Supabase JS `.in()`
      // does NOT match NULL values; we need both "never trained" and
      // "previously terminal" states to be claimable.
      const { data: claimed, error: claimErr } = await supabase
        .from("characters")
        .update({
          lora_training_status: "queued",
          lora_training_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", characterId)
        .eq("user_id", req.userId)
        .is("deleted_at", null)
        .or(
          "lora_training_status.is.null,lora_training_status.in.(succeeded,failed,cancelled)",
        )
        .select("id")
      if (claimErr) {
        reply.code(500).send({ error: "claim_failed" })
        return
      }
      if (!claimed?.length) {
        reply.code(409).send({ error: "already_training_or_not_found" })
        return
      }

      // Re-load full character row for image aggregation + name.
      const { data: character } = await supabase
        .from("characters")
        .select(
          "id, name, source_image_url, reference_photos, expressions, poses, angles, body_angles, lighting_variations",
        )
        .eq("id", characterId)
        .eq("user_id", req.userId)
        .single()
      if (!character) {
        // Should be impossible since CAS just succeeded.
        await supabase
          .from("characters")
          .update({ lora_training_status: null })
          .eq("id", characterId)
          .eq("user_id", req.userId)
        reply.code(404).send({ error: "not_found" })
        return
      }

      let zipKey: string | null = null
      let jobId: string | null = null

      try {
        // Step 2 — aggregate training images.
        const images = collectTrainingImages(character)
        const imageCount = images.length

        // Step 3 — zip + upload (returns public R2 URL; no signing needed).
        const { key, url: zipUrl } = await zipImagesToR2Buffer(
          images,
          characterId,
          req.userId,
        )
        zipKey = key

        // Step 4 — create job + reserve credits BEFORE dispatching to Replicate.
        const { data: job, error: jobErr } = await supabase
          .from("jobs")
          .insert({
            user_id: req.userId,
            job_type: "character-lora-training",
            status: "pending",
            input_data: { characterId, imageCount },
            metadata: { credit_identifier: TRAINING_CREDIT_ID },
          })
          .select("id")
          .single()
        if (jobErr || !job) throw new Error("job_create_failed")
        jobId = job.id

        const reservation = await reserveCreditsForJob(
          req,
          reply,
          job.id,
          TRAINING_CREDIT_ID,
        )
        if (reply.sent) {
          // creditGuard already responded (402/503). Throw to enter the catch
          // so CAS + zip cleanup fire.
          throw new Error("reservation_failed_reply_sent")
        }
        if (!reservation) throw new Error("reservation_failed")

        // Step 5 — derive trigger word + dispatch.
        const triggerWord = buildTriggerWord(character.name)
        const { trainingId } = await createCharacterTraining({
          characterId,
          zipUrl,
          triggerWord,
        })

        // Persist replicate id IMMEDIATELY — close the webhook-before-update race window.
        await supabase
          .from("characters")
          .update({
            lora_training_status: "training",
            lora_training_replicate_id: trainingId,
            lora_trigger_word: triggerWord,
            lora_training_image_count: imageCount,
            lora_training_error: null,
          })
          .eq("id", characterId)
          .eq("user_id", req.userId)
        await supabase
          .from("jobs")
          .update({
            status: "processing",
            provider: "replicate",
            started_at: new Date().toISOString(),
            metadata: {
              credit_identifier: TRAINING_CREDIT_ID,
              replicate_id: trainingId,
            },
          })
          .eq("id", job.id)
          .eq("user_id", req.userId)

        reply.code(202).send({ jobId: job.id, trainingId, triggerWord })
        return
      } catch (err) {
        const message =
          err instanceof InsufficientImagesError
            ? err.message
            : (err as Error).message

        // Rollback CAS-claimed slot.
        await supabase
          .from("characters")
          .update({ lora_training_status: null })
          .eq("id", characterId)
          .eq("user_id", req.userId)
          .then(() => {}, () => {})

        // Mark job failed + refund.
        if (jobId) {
          await supabase
            .from("jobs")
            .update({ status: "failed", error: message })
            .eq("id", jobId)
            .eq("user_id", req.userId)
            .then(() => {}, () => {})
          await refundReservedCreditsForJob(jobId).catch(() => {})
        }

        // Cleanup orphan zip in R2 (cleanup-cron doesn't cover this prefix).
        if (zipKey) {
          await deleteFromR2(zipKey).catch(() => {})
        }

        // If creditGuard already responded, don't try to send again.
        if (reply.sent) return
        if (err instanceof InsufficientImagesError) {
          reply
            .code(400)
            .send({ error: err.code, count: err.count, message })
          return
        }
        reply.code(502).send({ error: "training_dispatch_failed", message })
        return
      }
    },
  )

  // ────────────────────────────────────────────────────────────────────────
  // GET /v1/characters/:id/training
  // ────────────────────────────────────────────────────────────────────────
  app.get(
    "/v1/characters/:id/training",
    async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
      if (!req.userId) {
        reply.code(401).send({ error: "unauthorized" })
        return
      }
      const params = idParams.safeParse(req.params)
      if (!params.success) {
        reply.code(400).send(formatZodError(params.error))
        return
      }

      const { data: character } = await supabase
        .from("characters")
        .select(
          "id, lora_training_status, lora_training_replicate_id, lora_training_error, lora_trained_at, lora_replicate_version, lora_trigger_word, lora_training_image_count",
        )
        .eq("id", params.data.id)
        .eq("user_id", req.userId)
        .is("deleted_at", null)
        .single()
      if (!character) {
        reply.code(404).send({ error: "not_found" })
        return
      }

      reply.send({
        status: character.lora_training_status ?? "untrained",
        trainingId: character.lora_training_replicate_id,
        error: character.lora_training_error,
        trainedAt: character.lora_trained_at,
        version: character.lora_replicate_version,
        triggerWord: character.lora_trigger_word,
        imageCount: character.lora_training_image_count,
      })
    },
  )

  // ────────────────────────────────────────────────────────────────────────
  // DELETE /v1/characters/:id/lora
  // ────────────────────────────────────────────────────────────────────────
  app.delete(
    "/v1/characters/:id/lora",
    async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
      if (!req.userId) {
        reply.code(401).send({ error: "unauthorized" })
        return
      }
      const params = idParams.safeParse(req.params)
      if (!params.success) {
        reply.code(400).send(formatZodError(params.error))
        return
      }

      const { data: character } = await supabase
        .from("characters")
        .select("id, lora_training_status, lora_training_replicate_id")
        .eq("id", params.data.id)
        .eq("user_id", req.userId)
        .is("deleted_at", null)
        .single()
      if (!character) {
        reply.code(404).send({ error: "not_found" })
        return
      }

      if (
        character.lora_training_status === "queued" ||
        character.lora_training_status === "training"
      ) {
        if (character.lora_training_replicate_id) {
          await cancelCharacterTraining(character.lora_training_replicate_id)
        }
        const { data: trainingJob } = await supabase
          .from("jobs")
          .select("id")
          .eq("user_id", req.userId)
          .eq("job_type", "character-lora-training")
          .eq("metadata->>replicate_id", character.lora_training_replicate_id)
          .order("created_at", { ascending: false })
          .limit(1)
          .single()
        if (trainingJob) {
          await refundReservedCreditsForJob(trainingJob.id).catch(() => {})
          await supabase
            .from("jobs")
            .update({ status: "cancelled" })
            .eq("id", trainingJob.id)
            .eq("user_id", req.userId)
            .then(() => {}, () => {})
        }
      }

      // Always: delete the Replicate model. Idempotent (404 swallowed).
      await deleteCharacterLora(`nodaroai/char-${params.data.id}`)

      await supabase
        .from("characters")
        .update({
          lora_replicate_version: null,
          lora_trigger_word: null,
          lora_training_status: null,
          lora_training_replicate_id: null,
          lora_training_error: null,
          lora_trained_at: null,
          lora_training_image_count: null,
        })
        .eq("id", params.data.id)
        .eq("user_id", req.userId)

      reply.send({ ok: true })
    },
  )
}
