import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { MEDIA_REQUIRED_ACTIONS as SHARED_MEDIA_REQUIRED, VALID_ACTIONS as SHARED_ACTIONS } from "../services/social/actions.js"
import {
  executePublish,
  NotConnectedError,
  UnknownOutcomeError,
} from "../services/social/execute-publish.js"
import type { PublishRequest } from "../services/social/platforms/index.js"
import { providerIds } from "../services/social/providers/registry.js"
import { BadBodyError, NotPublishedError, RefreshTokenError } from "../services/social/providers/types.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { safeUrlSchema } from "../lib/url-validator.js"
import { CreditsService } from "../ee/billing/credits.js"
import { INSTAGRAM_CAROUSEL_MIN_ITEMS, INSTAGRAM_CAROUSEL_MAX_ITEMS } from "@nodaro/shared"

// Shared with scheduled-posts CRUD (services/social/actions.ts) so the two
// routes can't drift.
const VALID_ACTIONS = SHARED_ACTIONS
const MEDIA_REQUIRED_ACTIONS = SHARED_MEDIA_REQUIRED

// This sync route must produce response HEADERS before its callers give up:
// the orchestrator's internal fetch (undici's default headersTimeout) and
// browsers both cut a headers-less response at ~300s. Slow publishers
// (Instagram container ingestion can take minutes) clamp their polling and
// retry budget to this deadline via metadata.publishDeadlineMs, so the route
// always answers — with a typed retryable failure when the platform was too
// slow — instead of the socket dying mid-handler and the client seeing an
// unknown outcome. The scheduled worker holds no HTTP response and sets no
// deadline, keeping the full budgets.
const SYNC_PUBLISH_DEADLINE_MS = 250_000

const publishSchema = z.object({
  // Derived from the provider registry — adding a network there updates this
  // enum automatically (no hand-maintained platform list).
  platform: z.enum(providerIds()),
  action: z.enum(VALID_ACTIONS),
  connectionId: z.string().uuid().optional(),
  caption: z.string().optional(),
  // SSRF gate: x/youtube/linkedin fetch these URLs server-side (see platforms/*.ts),
  // so they must use safeUrlSchema, not a bare url(). safeFetch in those clients
  // re-validates the resolved IP at connect time (DNS-rebinding defense).
  mediaUrl: safeUrlSchema.optional(),
  mediaItems: z.array(z.object({ type: z.enum(["photo", "video"]), url: safeUrlSchema })).optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  privacy: z.enum(["private", "unlisted", "public"]).optional(),
  chatId: z.string().optional(),
  parseMode: z.enum(["Markdown", "HTML"]).optional(),
})

export async function socialPublishRoutes(app: FastifyInstance) {
  app.post("/v1/social/publish", {
    preHandler: creditGuard(() => "social-publish"),
  }, async (req, reply) => {
    const userId = req.userId
    if (!userId) return reply.status(401).send({ error: { code: "unauthorized" } })

    const workflowId = extractWorkflowId(req.body as Record<string, unknown>)
    const parsed = publishSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: parsed.error.message } })
    }

    const { platform, action, connectionId, caption, mediaUrl, mediaItems, title, description, tags, privacy, chatId, parseMode } = parsed.data

    if (MEDIA_REQUIRED_ACTIONS.has(action) && !mediaUrl && (!mediaItems || mediaItems.length === 0)) {
      return reply.status(400).send({
        error: { code: "validation_error", message: `Action "${action}" requires media` },
      })
    }

    // Instagram carousel rules: min/max items, all same type, no mixing.
    if (action === "post-carousel") {
      if (platform !== "instagram") {
        return reply.status(400).send({
          error: { code: "validation_error", message: `Carousel is only supported on Instagram right now` },
        })
      }
      const items = mediaItems ?? []
      if (items.length < INSTAGRAM_CAROUSEL_MIN_ITEMS || items.length > INSTAGRAM_CAROUSEL_MAX_ITEMS) {
        return reply.status(400).send({
          error: { code: "validation_error", message: `Instagram carousel needs ${INSTAGRAM_CAROUSEL_MIN_ITEMS}-${INSTAGRAM_CAROUSEL_MAX_ITEMS} items (got ${items.length})` },
        })
      }
      const types = new Set(items.map((m) => m.type))
      if (types.size > 1) {
        return reply.status(400).send({
          error: { code: "validation_error", message: `Instagram carousel can't mix photos and videos — pick one type` },
        })
      }
    }

    // Create job record
    const { data: job, error: jobErr } = await supabase
      .from("jobs")
      .insert({
        user_id: userId,
        workflow_id: workflowId || null,
        status: "processing",
        input_data: buildJobInputData(parsed.data, "social-publish"),
        provider: "social-publish",
        job_type: "social-publish",
      })
      .select("id")
      .single()

    if (jobErr || !job) {
      return reply.status(500).send({ error: { code: "internal_error" } })
    }

    // Reserve credits
    const reservation = await reserveCreditsForJob(req, reply, job.id, "social-publish")
    if (reply.sent) return

    try {
      const publishReq: PublishRequest = { action, caption, mediaUrl, mediaItems, title, description, tags, privacy }
      const extraMetadata: Record<string, unknown> = {}
      if (chatId) extraMetadata.chatId = chatId
      if (parseMode) extraMetadata.parseMode = parseMode
      extraMetadata.publishDeadlineMs = Date.now() + SYNC_PUBLISH_DEADLINE_MS

      // Shared executor — same token-refresh/reconnect/typed-error semantics
      // as the scheduled-publish worker (services/social/execute-publish.ts).
      const result = await executePublish({
        userId,
        platform,
        connectionId,
        request: publishReq,
        extraMetadata,
      })

      // Update job as completed
      await supabase
        .from("jobs")
        .update({
          status: "completed",
          output_data: {
            platformPostId: result.platformPostId,
            platformPostUrl: result.platformPostUrl,
          },
        })
        .eq("id", job.id)

      return {
        jobId: job.id,
        success: true,
        platformPostId: result.platformPostId,
        platformPostUrl: result.platformPostUrl,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Publish failed"
      app.log.error({ err, platform, action }, "Social publish failed")

      await supabase
        .from("jobs")
        .update({ status: "failed", output_data: { error: message } })
        .eq("id", job.id)

      // Refund reserved credits on failure
      if (reservation?.usageLogId) {
        try {
          await CreditsService.refundCredits(reservation.usageLogId)
        } catch (refundErr) {
          app.log.error({ refundErr, jobId: job.id }, "Failed to refund credits after social publish failure")
        }
      }

      // Typed outcomes map to the same wire responses as before the refactor.
      if (err instanceof NotConnectedError) {
        return reply.status(400).send({ error: { code: "not_connected", message } })
      }
      if (err instanceof RefreshTokenError) {
        const code = (err as RefreshTokenError & { code?: string }).code ?? "token_expired"
        return reply.status(400).send({ error: { code, message } })
      }
      if (err instanceof BadBodyError) {
        return reply.status(400).send({ error: { code: "publish_failed", message } })
      }
      if (err instanceof NotPublishedError) {
        // Nothing was posted and a retry is duplicate-free. 503 + a distinct
        // code so a client can safely re-issue this one — unlike the 500
        // below, which it must NOT blind-retry.
        return reply.status(503).send({ error: { code: "publish_retryable", message } })
      }
      // UnknownOutcomeError (provider call in flight when it failed — the
      // message says the post MAY have gone out) + unexpected errors: 500.
      return reply.status(500).send({ error: { code: "publish_failed", message } })
    }
  })
}
