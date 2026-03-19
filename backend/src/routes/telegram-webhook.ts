import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { decryptToken } from "../services/social/encryption.js"
import { config } from "../lib/config.js"
import { orchestrationQueue } from "../lib/orchestration-queue.js"
import { uploadBufferToR2 } from "../lib/storage.js"
import type { WorkflowExecutionJob } from "../services/workflow-engine/types.js"
import {
  getTriggersForToken,
  generateWebhookToken,
  registerTelegramWebhook,
  unregisterTelegramWebhook,
  downloadTelegramFile,
  addTriggerToRoute,
  removeTriggerFromRoute,
} from "../lib/telegram-router.js"

export async function telegramWebhookRoutes(app: FastifyInstance) {
  // POST /v1/telegram/webhook/:webhookToken — public, no auth
  app.post("/v1/telegram/webhook/:webhookToken", async (req, reply) => {
    const { webhookToken } = req.params as { webhookToken: string }
    const triggers = getTriggersForToken(webhookToken)
    if (triggers.length === 0) {
      return reply.status(404).send({ error: "Unknown webhook" })
    }

    // Validate Telegram secret_token header
    const telegramSecret = req.headers["x-telegram-bot-api-secret-token"] as string | undefined
    if (triggers[0].secretToken && telegramSecret !== triggers[0].secretToken) {
      return reply.status(403).send({ error: "Invalid secret" })
    }

    const update = req.body as Record<string, unknown>
    const message = (update.message || update.channel_post) as Record<string, unknown> | undefined
    if (!message) {
      return { ok: true }
    }

    const chatId = String((message.chat as Record<string, unknown>)?.id || "")
    const messageId = String(message.message_id || "")
    const text = (message.text || message.caption || "") as string

    let messageType = "text"
    if (message.photo) messageType = "photo"
    else if (message.video) messageType = "video"
    else if (message.audio || message.voice) messageType = "audio"
    else if (message.document) messageType = "document"

    // Extract file_ids for media types (before the loop — shared across triggers)
    const photoFileId = message.photo
      ? (message.photo as Array<{ file_id: string }>).at(-1)?.file_id
      : undefined
    const videoFileId = message.video
      ? (message.video as { file_id: string }).file_id
      : undefined
    const audioFileId = (message.audio || message.voice)
      ? ((message.audio || message.voice) as { file_id: string }).file_id
      : undefined

    // Hoist connection lookup — all triggers for one webhookToken share the same bot/user
    const { data: conn } = await supabase
      .from("social_connections")
      .select("access_token_encrypted")
      .eq("user_id", triggers[0].userId)
      .eq("platform", "telegram")
      .limit(1)
      .single()

    // Download media once and upload to R2 (shared across all triggers)
    let imageUrl: string | undefined
    let videoUrl: string | undefined
    let audioUrl: string | undefined

    if (conn) {
      const botToken = decryptToken(conn.access_token_encrypted)
      const keyPrefix = `telegram/${triggers[0].userId}/${messageId}`

      const downloads = await Promise.all([
        photoFileId ? downloadTelegramFile(botToken, photoFileId) : null,
        videoFileId ? downloadTelegramFile(botToken, videoFileId) : null,
        audioFileId ? downloadTelegramFile(botToken, audioFileId) : null,
      ])

      if (downloads[0]) imageUrl = await uploadBufferToR2(downloads[0], `${keyPrefix}-photo.jpg`, "image/jpeg")
      if (downloads[1]) videoUrl = await uploadBufferToR2(downloads[1], `${keyPrefix}-video.mp4`, "video/mp4")
      if (downloads[2]) audioUrl = await uploadBufferToR2(downloads[2], `${keyPrefix}-audio.ogg`, "audio/ogg")
    }

    for (const trigger of triggers) {
      if (trigger.chatIdFilter && chatId !== trigger.chatIdFilter && `@${chatId}` !== trigger.chatIdFilter) {
        continue
      }
      if (trigger.messageTypeFilters?.length && !trigger.messageTypeFilters.includes(messageType)) {
        continue
      }

      const triggerData: Record<string, unknown> = {
        text, chatId, messageId, messageType,
      }
      if (imageUrl) triggerData.imageUrl = imageUrl
      if (videoUrl) triggerData.videoUrl = videoUrl
      if (audioUrl) triggerData.audioUrl = audioUrl

      // Create execution and enqueue orchestrator
      const { data: execution } = await supabase
        .from("workflow_executions")
        .insert({
          workflow_id: trigger.workflowId,
          user_id: trigger.userId,
          status: "pending",
          trigger_type: "telegram",
          trigger_data: triggerData,
        })
        .select("id")
        .single()

      if (execution) {
        const jobData: WorkflowExecutionJob = {
          executionId: execution.id,
          workflowId: trigger.workflowId,
          userId: trigger.userId,
          triggerType: "telegram",
          triggerData,
        }
        await orchestrationQueue.add("workflow-execution", jobData, {
          jobId: execution.id,
        })
      }
    }

    return { ok: true }
  })

  // POST /v1/telegram/triggers — authenticated
  app.post("/v1/telegram/triggers", async (req, reply) => {
    const userId = req.userId
    if (!userId) return reply.status(401).send({ error: { code: "unauthorized" } })

    const schema = z.object({
      workflowId: z.string().uuid(),
      connectionId: z.string().uuid(),
      chatIdFilter: z.string().optional(),
      messageTypeFilters: z.array(z.string()).optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: parsed.error.message } })
    }

    const { workflowId, connectionId, chatIdFilter, messageTypeFilters } = parsed.data

    const { data: conn } = await supabase
      .from("social_connections")
      .select("*")
      .eq("id", connectionId)
      .eq("user_id", userId)
      .single()

    if (!conn) {
      return reply.status(400).send({ error: { code: "not_found", message: "Connection not found" } })
    }

    const botToken = decryptToken(conn.access_token_encrypted)
    const webhookToken = generateWebhookToken()
    const secretToken = generateWebhookToken()

    const publicUrl = config.PUBLIC_URL || "http://localhost:8000"
    await registerTelegramWebhook(botToken, webhookToken, secretToken, publicUrl)

    const { data: trigger, error } = await supabase
      .from("workflow_triggers")
      .insert({
        workflow_id: workflowId,
        user_id: userId,
        type: "telegram",
        config: {
          botId: conn.platform_user_id,
          connectionId,
          chatIdFilter: chatIdFilter || null,
          messageTypeFilters: messageTypeFilters || ["text", "photo", "video", "audio", "document"],
          secretToken,
        },
        webhook_token: webhookToken,
        is_active: true,
      })
      .select("id")
      .single()

    if (error || !trigger) {
      return reply.status(500).send({ error: { code: "internal_error" } })
    }

    addTriggerToRoute(webhookToken, {
      triggerId: trigger.id,
      workflowId,
      userId,
      chatIdFilter: chatIdFilter || undefined,
      messageTypeFilters: messageTypeFilters || undefined,
      secretToken,
    })

    return { triggerId: trigger.id, webhookToken }
  })

  // DELETE /v1/telegram/triggers/:id — authenticated
  app.delete("/v1/telegram/triggers/:id", async (req, reply) => {
    const userId = req.userId
    if (!userId) return reply.status(401).send({ error: { code: "unauthorized" } })

    const paramsParsed = z.object({ id: z.string().uuid() }).safeParse(req.params)
    if (!paramsParsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: "Invalid trigger ID" } })
    }
    const { id } = paramsParsed.data

    const { data: trigger } = await supabase
      .from("workflow_triggers")
      .select("*")
      .eq("id", id)
      .eq("user_id", userId)
      .single()

    if (!trigger) {
      return reply.status(404).send({ error: { code: "not_found" } })
    }

    const cfg = trigger.config as Record<string, unknown>
    const connectionId = cfg.connectionId as string

    const { data: conn } = await supabase
      .from("social_connections")
      .select("access_token_encrypted")
      .eq("id", connectionId)
      .eq("user_id", userId)
      .single()

    if (conn) {
      try {
        const botToken = decryptToken(conn.access_token_encrypted)
        await unregisterTelegramWebhook(botToken)
      } catch {
        // Best effort
      }
    }

    await supabase
      .from("workflow_triggers")
      .update({ is_active: false })
      .eq("id", id)

    removeTriggerFromRoute(trigger.webhook_token, id)

    return { success: true }
  })
}
