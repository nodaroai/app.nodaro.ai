import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { decryptToken } from "../services/social/encryption.js"
import { orchestrationQueue } from "../lib/orchestration-queue.js"
import { uploadBufferToR2 } from "../lib/storage.js"
import type { WorkflowExecutionJob } from "../services/workflow-engine/types.js"
import { resolveBillingContext, shouldRefuseDegradedRunFor } from "../lib/billing-context.js"
import { billingPairColumns } from "../lib/insert-job.js"
import { canRunWorkflow } from "../lib/workflow-access.js"
import { recordTriggerFireRefusal } from "../lib/trigger-fire-refusal.js"
import { refusePreviewFire } from "../lib/preview-fire-refusal.js"
import { getRouteForToken, downloadTelegramFile } from "../lib/telegram-router.js"
import { ensureBotRegistration, syncBotRegistration } from "../lib/telegram-trigger-activation.js"

export async function telegramWebhookRoutes(app: FastifyInstance) {
  // POST /v1/telegram/webhook/:webhookToken — public, no auth
  app.post("/v1/telegram/webhook/:webhookToken", async (req, reply) => {
    const { webhookToken } = req.params as { webhookToken: string }
    // Every trigger on this bot, not just the one that happens to hold the
    // url — a bot delivers to ONE address and all of its triggers listen
    // behind it.
    const route = getRouteForToken(webhookToken)
    const triggers = route?.triggers ?? []
    if (triggers.length === 0) {
      return reply.status(404).send({ error: "Unknown webhook" })
    }

    // Validate Telegram secret_token header. Fail-CLOSED: a url with no stored
    // secret cannot authenticate the caller as Telegram, so reject rather than
    // accept an unverified update. Registration always sets a secret, so this
    // only rejects misconfigured/legacy rows — which should not be processing
    // updates anyway. The secret belongs to the URL, not to the trigger: it is
    // what was handed to `setWebhook` for this token.
    const telegramSecret = req.headers["x-telegram-bot-api-secret-token"] as string | undefined
    if (!route?.secretToken || telegramSecret !== route.secretToken) {
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

    // Hoist connection lookup — every trigger on this url is the same bot, so
    // one lookup serves them all. Ask for THAT bot by id where the rows name
    // it: a user with two bots would otherwise download this bot's media with
    // the other one's token and get nothing back.
    const botConnectionId = triggers.find((t) => t.connectionId)?.connectionId
    const connectionQuery = supabase
      .from("social_connections")
      .select("access_token_encrypted")
      .eq("user_id", triggers[0].userId)
      .eq("platform", "telegram")
    const { data: conn } = botConnectionId
      ? await connectionQuery.eq("id", botConnectionId).maybeSingle()
      : await connectionQuery.limit(1).maybeSingle()

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

      // Does the trigger's owner STILL have the right to run this workflow?
      // The same fire-time question the webhook and schedule lanes ask —
      // this lane simply never asked it (P14/W6 closes that): a trigger
      // outlives the session that created it, and without this the bot
      // keeps firing the current graph after the owner lost access. Refuse
      // with ONE visible failed row (deduped); reply ok to Telegram either
      // way (a retry storm helps nobody).
      if (!(await canRunWorkflow(trigger.userId, trigger.workflowId))) {
        await recordTriggerFireRefusal({
          workflowId: trigger.workflowId,
          userId: trigger.userId,
          triggerType: "telegram",
          triggerId: trigger.triggerId,
        })
        continue
      }

      // The branch this message runs stops at a Preview render, and a bot
      // conversation cannot review it: refuse before anything is created or
      // billed, with one deduped failed row for the owner.
      if (
        await refusePreviewFire({
          workflowId: trigger.workflowId,
          userId: trigger.userId,
          triggerType: "telegram",
          triggerId: trigger.triggerId,
          triggerNodeId: trigger.nodeId ?? null,
        })
      ) {
        continue
      }

      // P14: payer resolved at FIRE TIME under the trigger's owner and the
      // workflow's CURRENT home; the row carries the pair (W7).
      const billingContext = await resolveBillingContext({
        userId: trigger.userId,
        workflowId: trigger.workflowId,
      })
      // P14: a DEGRADED resolve on WORKSPACE-HOMED (or unreadable-home)
      // work skips this trigger (Telegram gets its usual ok) rather than
      // billing the owner's pocket — the ONE fail-closed probe.
      if (await shouldRefuseDegradedRunFor(billingContext, trigger.workflowId)) {
        req.log.error({ triggerId: trigger.triggerId }, "degraded billing resolve on workspace workflow — telegram fire skipped")
        continue
      }
      // Create execution and enqueue orchestrator
      const { data: execution } = await supabase
        .from("workflow_executions")
        .insert({
          workflow_id: trigger.workflowId,
          user_id: trigger.userId,
          status: "pending",
          trigger_type: "telegram",
          trigger_data: triggerData,
          ...billingPairColumns(billingContext),
        })
        .select("id")
        .single()

      if (execution) {
        const jobData: WorkflowExecutionJob = {
          executionId: execution.id,
          workflowId: trigger.workflowId,
          userId: trigger.userId,
          triggerType: "telegram",
          // The node this row was projected from: the worker runs the branch
          // behind it (`triggerRunScope`), the same way the webhook and
          // schedule lanes do. Without it, two Telegram Triggers on one canvas
          // would each fan out to a run of the WHOLE workflow. A hand-made
          // row names none and falls back to the lane's only node.
          ...(trigger.nodeId ? { triggerNodeId: trigger.nodeId } : {}),
          triggerData,
          billingContext,
          // A bot conversation cannot review a Preview render.
          reviewerPresent: false,
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

    // A trigger IS a standing run — creating one requires the same right the
    // fire-time gate checks (the webhook trigger-create route's rule).
    if (!(await canRunWorkflow(userId, workflowId))) {
      return reply.status(403).send({
        error: { code: "forbidden", message: "You do not have permission to run this workflow" },
      })
    }

    const { data: conn } = await supabase
      .from("social_connections")
      .select("id, platform_user_id")
      .eq("id", connectionId)
      .eq("user_id", userId)
      .eq("platform", "telegram")
      .single()

    if (!conn) {
      return reply.status(400).send({ error: { code: "not_found", message: "Connection not found" } })
    }

    // One registration per BOT, shared by every trigger on it — minting a
    // fresh url here would silently un-subscribe the bot's other triggers.
    let registration: Awaited<ReturnType<typeof ensureBotRegistration>>
    try {
      registration = await ensureBotRegistration({ userId, connectionId })
    } catch (err) {
      return reply.status(400).send({
        error: { code: "telegram_error", message: err instanceof Error ? err.message : "Activation failed" },
      })
    }

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
          secretToken: registration.secretToken,
        },
        webhook_token: registration.webhookToken,
        is_active: true,
      })
      .select("id")
      .single()

    if (error || !trigger) {
      return reply.status(500).send({ error: { code: "internal_error" } })
    }

    await syncBotRegistration({ userId, connectionId })

    return { triggerId: trigger.id, webhookToken: registration.webhookToken }
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

    const cfg = (trigger.config ?? {}) as Record<string, unknown>
    const connectionId = typeof cfg.connectionId === "string" ? cfg.connectionId : ""

    // The url leaves with the trigger: `webhook_token` is UNIQUE, so a row
    // parked inactive while still holding it would block the handover below.
    await supabase
      .from("workflow_triggers")
      .update({ is_active: false, webhook_token: null })
      .eq("id", id)
      .eq("user_id", userId)

    // The bot is only taken down when this was its LAST trigger; when others
    // remain, the url this row held is handed to one of them.
    await syncBotRegistration({
      userId,
      connectionId,
      releasedUrls: trigger.webhook_token
        ? [{ token: trigger.webhook_token as string, secret: typeof cfg.secretToken === "string" ? cfg.secretToken : "" }]
        : [],
    })

    return { success: true }
  })
}
