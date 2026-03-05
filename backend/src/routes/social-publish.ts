import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { decryptToken, encryptToken } from "../services/social/encryption.js"
import { refreshAccessToken, type SocialPlatform } from "../services/social/oauth.js"
import { platformPublishers, type PublishRequest } from "../services/social/platforms/index.js"
import { extractWorkflowId } from "../lib/request-helpers.js"
import { CreditsService } from "../billing/credits.js"

const VALID_ACTIONS = [
  "post-image", "post-reel", "post-story", "post-carousel",
  "post-video", "upload-video", "upload-short",
  "post-text", "post-tweet",
] as const

const MEDIA_REQUIRED_ACTIONS = new Set([
  "post-image", "post-reel", "post-story", "post-carousel",
  "post-video", "upload-video", "upload-short",
])

const publishSchema = z.object({
  platform: z.enum(["instagram", "tiktok", "youtube", "linkedin", "x", "facebook"]),
  action: z.enum(VALID_ACTIONS),
  connectionId: z.string().uuid().optional(),
  caption: z.string().optional(),
  mediaUrl: z.string().url().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  privacy: z.enum(["private", "unlisted", "public"]).optional(),
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

    const { platform, action, connectionId, caption, mediaUrl, title, description, tags, privacy } = parsed.data

    if (MEDIA_REQUIRED_ACTIONS.has(action) && !mediaUrl) {
      return reply.status(400).send({
        error: { code: "validation_error", message: `Action "${action}" requires a media URL` },
      })
    }

    // Get connection — by ID if provided, otherwise first match for platform
    let connQuery = supabase
      .from("social_connections")
      .select("*")
      .eq("user_id", userId)

    if (connectionId) {
      connQuery = connQuery.eq("id", connectionId).eq("platform", platform)
    } else {
      connQuery = connQuery.eq("platform", platform).limit(1)
    }

    const { data: connRows, error: connErr } = await connQuery
    const connection = connRows?.[0]

    if (connErr || !connection) {
      return reply.status(400).send({
        error: { code: "not_connected", message: `No ${platform} account connected. Please connect in Settings > Integrations.` },
      })
    }

    // Decrypt access token
    let accessToken = decryptToken(connection.access_token_encrypted)

    // Check if token is expired and refresh
    if (connection.token_expires_at && new Date(connection.token_expires_at) <= new Date()) {
      if (!connection.refresh_token_encrypted) {
        return reply.status(400).send({
          error: { code: "token_expired", message: `Your ${platform} connection has expired. Please reconnect.` },
        })
      }

      try {
        const refreshToken = decryptToken(connection.refresh_token_encrypted)
        const refreshed = await refreshAccessToken(platform as SocialPlatform, refreshToken)
        accessToken = refreshed.accessToken

        // Update stored tokens
        const updateData: Record<string, unknown> = {
          access_token_encrypted: encryptToken(refreshed.accessToken),
          updated_at: new Date().toISOString(),
        }
        if (refreshed.refreshToken) {
          updateData.refresh_token_encrypted = encryptToken(refreshed.refreshToken)
        }
        if (refreshed.expiresIn) {
          updateData.token_expires_at = new Date(Date.now() + refreshed.expiresIn * 1000).toISOString()
        }

        await supabase
          .from("social_connections")
          .update(updateData)
          .eq("id", connection.id)
      } catch {
        return reply.status(400).send({
          error: { code: "refresh_failed", message: `Failed to refresh ${platform} token. Please reconnect.` },
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
        input_data: { platform, action, caption },
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
      const publisher = platformPublishers[platform as SocialPlatform]
      const metadata = (connection.metadata as Record<string, unknown>) || {}

      // Decrypt page_access_token if present (stored encrypted in metadata)
      if (metadata.page_access_token && typeof metadata.page_access_token === "string") {
        metadata.page_access_token = decryptToken(metadata.page_access_token)
      }

      const publishReq: PublishRequest = { action, caption, mediaUrl, title, description, tags, privacy }
      const result = await publisher.publish(accessToken, publishReq, metadata)

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

      return reply.status(500).send({ error: { code: "publish_failed", message } })
    }
  })
}
