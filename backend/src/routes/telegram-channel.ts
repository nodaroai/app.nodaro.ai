import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { fetchChannelPosts, normalizeChannel } from "../services/social/telegram-channel.js"
import { sendInternalError } from "../lib/http-errors.js"
import { supabase } from "../lib/supabase.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { commitReservedCreditsForJob, refundReservedCreditsForJob } from "../lib/credits-job-lifecycle.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { extractWorkflowId } from "../lib/request-helpers.js"

/**
 * Telegram Channel Feed — reads a PUBLIC channel's recent posts for
 * rewrite/repost workflows. The node calls this at runtime (sync-HTTP).
 *
 * Dedup is cursor-based and STATELESS on the server: the caller passes
 * `sinceId` (the highest post id it saw last run) and gets back only newer
 * posts plus the new `latestId` to persist.
 *
 * KNOWN GAP (tracked separately): only the EDITOR persists the returned
 * `latestId` (via updateNodeData + autosave). The orchestrator reads
 * `data.lastSeenId` but has nowhere durable to write it back, so a scheduled
 * "Schedule Trigger -> Feed -> Publish" chain refetches the same posts every
 * tick and republishes duplicates. Fixing that needs a server-side cursor
 * store, the way `last_triggered_at` solved this class for triggers.
 */

const schema = z.object({
  channel: z.string().min(1),
  sinceId: z.number().int().nonnegative().optional(),
  limit: z.number().int().min(1).max(20).optional(),
})

export async function telegramChannelRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/telegram-channel/fetch", {
    // The node is priced at 1 credit everywhere it is DESCRIBED — STATIC_CREDIT_COSTS,
    // migration 266, NODE_DEFINITIONS, the paid badge, the public docs — but the
    // handler used to bill nothing, so runtime diverged from documented pricing.
    preHandler: creditGuard(() => "telegram-channel-feed"),
  }, async (req, reply) => {
    const userId = req.userId
    if (!userId) return reply.status(401).send({ error: { code: "unauthorized" } })

    const workflowId = extractWorkflowId(req.body as Record<string, unknown>)
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: parsed.error.message } })
    }
    const { channel, sinceId, limit } = parsed.data

    if (!normalizeChannel(channel)) {
      return reply.status(400).send({
        error: { code: "validation_error", message: `"${channel}" is not a valid Telegram channel name` },
      })
    }

    // Validation rejects above cost nothing — the job row (and the reservation
    // attached to it) is only created once the request is known to be runnable.
    const { data: job, error: jobErr } = await supabase
      .from("jobs")
      .insert({
        user_id: userId,
        workflow_id: workflowId || null,
        status: "processing",
        input_data: buildJobInputData(parsed.data, "telegram-channel-feed"),
        provider: "telegram-channel-feed",
        job_type: "telegram-channel-feed",
      })
      .select("id")
      .single()

    if (jobErr || !job) {
      return reply.status(500).send({ error: { code: "internal_error" } })
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, "telegram-channel-feed")
    if (reply.sent) return

    try {
      const all = await fetchChannelPosts(channel)
      // Only posts newer than the caller's cursor (first-run: everything).
      const fresh = sinceId ? all.filter((p) => p.id > sinceId) : all
      const capped = limit ? fresh.slice(-limit) : fresh
      const latestId = all.length ? all[all.length - 1]!.id : (sinceId ?? 0)

      // Newline-joined text of the fresh posts. `generatedText` is the field
      // the orchestrator's sync-HTTP path normalizes into the node's text
      // output (same convention as image-to-text); `text` is kept for the
      // frontend client.
      const joined = capped.map((p) => p.text).filter(Boolean).join("\n\n---\n\n")

      // `output_data` MUST carry the text, not just the cursor. Returning a
      // `jobId` (below) routes the orchestrator down its job-POLLING branch,
      // where the node's output is rebuilt from this row via
      // buildNodeOutputFromJobData — which normalizes `generatedText` -> `text`.
      // Omit it and backend/scheduled runs emit an EMPTY output while the HTTP
      // body still looks correct to the editor.
      await supabase
        .from("jobs")
        .update({
          status: "completed",
          output_data: { text: joined, generatedText: joined, latestId, count: capped.length },
        })
        .eq("id", job.id)
        .eq("user_id", userId)
      await commitReservedCreditsForJob(job.id)

      return {
        jobId: job.id,
        posts: capped,
        latestId,
        text: joined,
        generatedText: joined,
        count: capped.length,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to read channel"

      await supabase
        .from("jobs")
        .update({ status: "failed", output_data: { error: message } })
        .eq("id", job.id)
        .eq("user_id", userId)
      if (reservation) {
        try {
          await refundReservedCreditsForJob(job.id)
        } catch (refundErr) {
          req.log.error({ refundErr, jobId: job.id }, "Failed to refund credits after channel fetch failure")
        }
      }

      // User-facing channel errors (private/invalid/preview-off) are 400s, not
      // 500s — surface the clear message from the scraper.
      if (/valid Telegram channel|private, doesn't exist|preview disabled|Could not read/.test(message)) {
        return reply.status(400).send({ error: { code: "channel_error", message } })
      }
      return sendInternalError(reply, req, err, "Failed to read Telegram channel")
    }
  })
}
