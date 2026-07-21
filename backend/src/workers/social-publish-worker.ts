import { DelayedError, UnrecoverableError, Worker, type ConnectionOptions, type Job } from "bullmq"
import { redis } from "../lib/queue.js"
import type { SocialPublishJobData } from "../lib/social-queue.js"
import { supabase } from "../lib/supabase.js"
import { hasCredits } from "../lib/config.js"
import { acquireConnectionLock, releaseConnectionLock } from "../services/social/connection-lock.js"
import {
  executePublish,
  NotConnectedError,
  UnknownOutcomeError,
} from "../services/social/execute-publish.js"
import { resolveMediaRefs, type ScheduledMediaRef } from "../services/social/media-refs.js"
import type { PublishRequest } from "../services/social/platforms/index.js"
import { BadBodyError, RefreshTokenError } from "../services/social/providers/types.js"
import { commitJobCredits, isFinalJobAttempt, refundJobCredits } from "./shared.js"

/**
 * Scheduled social publish worker.
 *
 * Retry semantics (the Rev 2 hardening — verified missing in Postiz, where a
 * mid-publish crash double-posts):
 * - lock busy                → delay + re-schedule (no attempt consumed)
 * - NotConnected/Refresh/BadBody → definitive: row error (+refund), NO retry
 * - UnknownOutcome           → the provider call already started: row error
 *                              "may have published", refund, NO retry — a
 *                              human decides whether to re-schedule
 * - NotPublished             → the publisher PROVED nothing was posted and the
 *                              cause is transient (Instagram 9007): refund this
 *                              attempt and let BullMQ back off. Deliberately
 *                              NOT in the `definitive` set below — adding it
 *                              there would re-break the bug it exists to fix.
 * - anything else            → failed BEFORE the provider call: refund this
 *                              attempt, rethrow for BullMQ backoff retry
 */

interface ScheduledPostRow {
  id: string
  user_id: string
  connection_id: string
  platform: string
  action: string
  payload: Record<string, unknown>
  media: ScheduledMediaRef[]
  status: string
  attempts: number
  job_id: string | null
}

async function updateRow(id: string, patch: Record<string, unknown>): Promise<void> {
  await supabase
    .from("scheduled_posts")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
}

async function ensureJobRow(row: ScheduledPostRow): Promise<string | null> {
  if (row.job_id) return row.job_id
  const { data } = await supabase
    .from("jobs")
    .insert({
      user_id: row.user_id,
      status: "processing",
      provider: "social-publish",
      job_type: "social-publish",
      // Not gallery media — see routes/social-publish.ts: is_public defaults
      // TRUE and the gallery RLS makes completed public rows world-readable.
      is_public: false,
      input_data: {
        type: "social-publish",
        scheduled: true,
        scheduledPostId: row.id,
        platform: row.platform,
        action: row.action,
      },
    })
    .select("id")
    .single()
  const jobId = (data as { id: string } | null)?.id ?? null
  if (jobId) await updateRow(row.id, { job_id: jobId })
  return jobId
}

/** Reserve credits from worker context (no req/reply). EE import stays dynamic. */
async function reserveScheduledCredits(userId: string, jobId: string): Promise<string | null> {
  if (!hasCredits()) return null
  const { CreditsService } = await import("../ee/services/credits.js")
  const result = await CreditsService.reserveCredits(userId, jobId, "social-publish", 0, 0)
  return result.usageLogId
}

export async function processScheduledPost(job: Job<SocialPublishJobData>, token?: string): Promise<void> {
  const { scheduledPostId } = job.data

  const { data: rowData } = await supabase
    .from("scheduled_posts")
    .select("*")
    .eq("id", scheduledPostId)
    .single()
  const row = rowData as ScheduledPostRow | null
  // Row gone or no longer publishable (canceled/edited/published elsewhere) — drop silently.
  if (!row || !["queued", "publishing"].includes(row.status)) return

  // Per-connection serialization: one in-flight publish per connection.
  const lockToken = await acquireConnectionLock(row.connection_id)
  if (!lockToken) {
    await job.moveToDelayed(Date.now() + 15_000, token)
    throw new DelayedError()
  }

  let usageLogId: string | null = null
  let jobId: string | null = null
  try {
    await updateRow(row.id, { status: "publishing", attempts: row.attempts + 1 })

    jobId = await ensureJobRow(row)
    if (jobId) usageLogId = await reserveScheduledCredits(row.user_id, jobId)

    const payload = row.payload ?? {}
    const request: PublishRequest = {
      action: row.action,
      caption: payload.caption as string | undefined,
      title: payload.title as string | undefined,
      description: payload.description as string | undefined,
      tags: payload.tags as string[] | undefined,
      privacy: payload.privacy as string | undefined,
    }
    const media = resolveMediaRefs(row.media ?? [])
    if (media.length === 1) request.mediaUrl = media[0]!.url
    if (media.length >= 1) request.mediaItems = media

    const extraMetadata: Record<string, unknown> = {}
    if (payload.chatId) extraMetadata.chatId = payload.chatId
    if (payload.parseMode) extraMetadata.parseMode = payload.parseMode

    const result = await executePublish({
      userId: row.user_id,
      platform: row.platform,
      connectionId: row.connection_id,
      request,
      extraMetadata,
    })

    await updateRow(row.id, {
      status: "published",
      last_error: null,
      platform_post_id: result.platformPostId ?? null,
      platform_post_url: result.platformPostUrl ?? null,
    })
    if (jobId) {
      await supabase
        .from("jobs")
        .update({
          status: "completed",
          output_data: {
            platformPostId: result.platformPostId,
            platformPostUrl: result.platformPostUrl,
            scheduledPostId: row.id,
          },
        })
        .eq("id", jobId)
      await commitJobCredits(usageLogId, jobId)
    }
  } catch (err) {
    if (err instanceof DelayedError) throw err

    const message = err instanceof Error ? err.message : "Publish failed"
    const definitive =
      err instanceof NotConnectedError ||
      err instanceof RefreshTokenError ||
      err instanceof BadBodyError ||
      err instanceof UnknownOutcomeError

    if (definitive || isFinalJobAttempt(job)) {
      await updateRow(row.id, { status: "error", last_error: message })
      if (jobId) {
        await supabase
          .from("jobs")
          .update({ status: "failed", output_data: { error: message } })
          .eq("id", jobId)
        await refundJobCredits(usageLogId, jobId, err)
      }
      if (definitive) throw new UnrecoverableError(message)
      throw err
    }

    // Retryable (failed BEFORE the provider call): refund this attempt's
    // reservation — the next attempt re-reserves — and let BullMQ back off.
    if (jobId) await refundJobCredits(usageLogId, jobId, err)
    await updateRow(row.id, { status: "queued", last_error: message })
    throw err
  } finally {
    await releaseConnectionLock(row.connection_id, lockToken)
  }
}

export function createSocialPublishWorker(): Worker<SocialPublishJobData> {
  const worker = new Worker<SocialPublishJobData>("social-publish", processScheduledPost, {
    connection: redis as unknown as ConnectionOptions,
    concurrency: 5,
  })
  worker.on("failed", (job, err) => {
    if (!(err instanceof UnrecoverableError)) {
      console.error(`[social-publish] job ${job?.id} failed:`, err.message)
    }
  })
  return worker
}
