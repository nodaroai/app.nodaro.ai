/**
 * Replicate training callback webhook.
 *
 * Public route (`/v1/webhooks/*` is allow-listed in `auth.ts:97`).
 * Auth = Standard Webhooks HMAC verification via Replicate SDK's
 * `validateWebhook` helper (top-level export, NOT a static method on the
 * `Replicate` class).
 *
 * This codebase has NO `fastify-raw-body` plugin — the rawBody must come from
 * an in-plugin `addContentTypeParser` override (mirrors
 * `backend/src/ee/routes/stripe-webhook.ts:42-53`).
 *
 * All UPDATEs are MONOTONIC: `WHERE lora_training_status NOT IN ('succeeded',
 * 'cancelled')` so late/duplicate events can't regress terminal state.
 *
 * Soft-deleted rows are still processed (refund + model cleanup) per design
 * §6.2 — the soft-delete handler in `routes/characters.ts` covers the happy
 * path, but the webhook is the defense-in-depth net.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { hasCredits, config } from "../lib/config.js"
import { supabase } from "../lib/supabase.js"
import { validateWebhook } from "../providers/replicate/client.js"
import { refundReservedCreditsForJob } from "../lib/character-lora.js"
import { deleteCharacterLora } from "../providers/replicate/training.js"
import { CHARACTER_LORA_TRAINING_JOB_TYPE } from "@nodaro/shared"

export async function replicateTrainingWebhookRoutes(
  app: FastifyInstance,
): Promise<void> {
  if (!hasCredits()) return

  // Mirror backend/src/ee/routes/stripe-webhook.ts:42-53 — no fastify-raw-body
  // plugin exists, so { config: { rawBody: true } } is a no-op. This parser
  // stashes the raw text on req before JSON parsing.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (
      _req: FastifyRequest,
      body: string,
      done: (err: Error | null, result?: unknown) => void,
    ) => {
      ;(_req as unknown as Record<string, unknown>).rawBody = body
      try {
        const json = body.length ? JSON.parse(body) : {}
        done(null, json)
      } catch (err) {
        done(err as Error)
      }
    },
  )

  app.post(
    "/v1/webhooks/replicate-training",
    async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
      // Fast-fail on missing env — better than a 500 from validateWebhook throw.
      if (!config.REPLICATE_WEBHOOK_SECRET) {
        console.error(
          "[replicate-training-webhook] REPLICATE_WEBHOOK_SECRET not set",
        )
        reply.code(503).send({ error: "webhook_not_configured" })
        return
      }

      const headers = req.headers as Record<string, string | undefined>
      const rawBody = (req as unknown as { rawBody?: string }).rawBody
      if (
        !rawBody ||
        !headers["webhook-id"] ||
        !headers["webhook-timestamp"] ||
        !headers["webhook-signature"]
      ) {
        reply.code(400).send({ error: "missing_headers_or_body" })
        return
      }

      // validateWebhook THROWS on empty/missing inputs — wrap in try/catch.
      let valid = false
      try {
        valid = await validateWebhook({
          id: headers["webhook-id"]!,
          timestamp: headers["webhook-timestamp"]!,
          signature: headers["webhook-signature"]!,
          body: rawBody,
          secret: config.REPLICATE_WEBHOOK_SECRET,
        })
      } catch (err) {
        console.warn(
          `[replicate-training-webhook] validate threw: ${(err as Error).message}`,
        )
        reply.code(401).send({ error: "invalid_signature" })
        return
      }
      if (!valid) {
        reply.code(401).send({ error: "invalid_signature" })
        return
      }

      const body = req.body as {
        id: string
        status:
          | "starting"
          | "processing"
          | "succeeded"
          | "failed"
          | "canceled"
        output?: unknown
        error?: string
        version?: string // "nodaroai/char-<uuid>:<hash>"
      }

      // Lookup character by training id. Include soft-deleted rows (defense
      // in depth — the route soft-delete handler should have cleaned up but
      // the webhook is the safety net).
      const { data: character } = await supabase
        .from("characters")
        .select("id, user_id, lora_training_status, deleted_at")
        .eq("lora_training_replicate_id", body.id)
        .single()
      if (!character) {
        console.warn(
          `[replicate-training-webhook] unknown training id ${body.id}`,
        )
        // 200 ack so Replicate stops retrying.
        reply.send({ ok: true })
        return
      }

      // Find the matching job row for refund/state.
      const { data: job } = await supabase
        .from("jobs")
        .select("id")
        .eq("user_id", character.user_id)
        .eq("job_type", CHARACTER_LORA_TRAINING_JOB_TYPE)
        .eq("metadata->>replicate_id", body.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .single()

      if (body.status === "succeeded") {
        // Monotonic: never overwrite a terminal succeeded/cancelled state.
        await supabase
          .from("characters")
          .update({
            lora_training_status: "succeeded",
            lora_replicate_version: body.version ?? null,
            lora_trained_at: new Date().toISOString(),
            lora_training_error: null,
          })
          .eq("id", character.id)
          .eq("user_id", character.user_id)
          .not("lora_training_status", "in", "(succeeded,cancelled)")

        if (job) {
          await supabase
            .from("jobs")
            .update({
              status: "completed",
              completed_at: new Date().toISOString(),
            })
            .eq("id", job.id)
            .eq("user_id", character.user_id)
            .not("status", "in", "(completed,failed,cancelled)")
        }

        // If the row was soft-deleted between dispatch and webhook delivery,
        // also clean up the trained Replicate model.
        if (character.deleted_at) {
          await deleteCharacterLora(`nodaroai/char-${character.id}`)
        }
      } else if (body.status === "failed" || body.status === "canceled") {
        const finalStatus =
          body.status === "canceled" ? "cancelled" : "failed"

        await supabase
          .from("characters")
          .update({
            lora_training_status: finalStatus,
            lora_training_error: body.error ?? null,
          })
          .eq("id", character.id)
          .eq("user_id", character.user_id)
          .not("lora_training_status", "in", "(succeeded,cancelled)")

        if (job) {
          await supabase
            .from("jobs")
            .update({
              status: finalStatus,
              // Column is `error_message` — `error` does not exist, so the old
              // key made PostgREST reject the whole UPDATE (PGRST204) and the
              // job stayed stuck in 'processing'.
              error_message: body.error ?? null,
            })
            .eq("id", job.id)
            .eq("user_id", character.user_id)
            .not("status", "in", "(completed,failed,cancelled)")
          // refundCredits is itself idempotent (CAS on status='reserved').
          await refundReservedCreditsForJob(job.id).catch(() => {})
        }
      }
      // "starting" / "processing" events are filtered out via
      // webhook_events_filter=["completed"] at dispatch, but if they ever
      // arrive we just no-op (status='training' already set at submit).

      reply.send({ ok: true })
    },
  )
}
