import type { FastifyInstance } from "fastify"
import { z } from "zod"
import {
  TELEGRAM_FEED_DEFAULT_LIMIT,
  TELEGRAM_FEED_LIMIT_MAX,
  TELEGRAM_FEED_PAGE_SIZE,
  TELEGRAM_FEED_PEEK_MAX,
  planFeedEmission,
  telegramFeedDigest,
  type TelegramChannelPost,
} from "@nodaro/shared"
import { fetchChannelPosts, normalizeChannel } from "../services/social/telegram-channel.js"
import { readNodeCursor, readNodeCursorRow, resetNodeCursor, writeNodeCursor } from "../services/workflow-engine/node-cursor.js"
import { sendInternalError } from "../lib/http-errors.js"
import { insertJob } from "../lib/insert-job.js"
import { supabase } from "../lib/supabase.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { commitReservedCreditsForJob, refundReservedCreditsForJob } from "../lib/credits-job-lifecycle.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { extractNodeId, extractWorkflowId } from "../lib/request-helpers.js"
import { requireAppScope } from "../lib/scope-prehandler.js"

/**
 * Telegram Channel Feed — reads a PUBLIC channel's posts for follow / rewrite /
 * repost workflows. The node calls `POST /fetch` at runtime (sync-HTTP), from
 * the editor and from the orchestrator alike.
 *
 * THE ROUTE OWNS THE POSITION (decided 2026-10-05). With `workflowId` + `nodeId`
 * in the body the fetch is STATEFUL: the durable cursor (`node_cursors`,
 * migration 267) is read here, the posts above it are fetched (`?after=<id>`,
 * oldest first), and the cursor advances to the highest post EMITTED — a
 * backlog drains `limit` per run and nothing is lost. The first stateful run
 * (or the first after Reset) emits the newest `limit` posts and the position
 * jumps to the newest. The editor's single-node Run and a scheduled run move
 * the SAME position; `data.lastSeenId`, the editor's old cursor, is accepted
 * as a one-shot seed (`sinceId`) when no position is stored yet.
 *
 * `mode: "peek"` ("re-fetch the last N" in the panel) reads the newest page
 * and never touches the position. A fetch is a fetch: it is charged like a
 * poll. A fetch that returns NO post is not charged (the reservation is given
 * back — a scheduled feed polling an idle channel costs nothing).
 *
 * Output: `json` (the posts, `TelegramChannelPost[]`), one `listResults` item
 * per post (an "each" wire), `text` / `generatedText` (the digest — the field
 * the orchestrator's job-polling branch normalizes into the node's text),
 * `count`, `latestId`, and `cursor` (what the position is now and whether it
 * moved). `output_data` MUST carry the text: returning a `jobId` routes the
 * orchestrator down its job-POLLING branch, where the node's output is rebuilt
 * from the jobs row via buildNodeOutputFromJobData.
 */

const fetchSchema = z.object({
  channel: z.string().min(1),
  /** The editor's legacy cursor (`data.lastSeenId`) — a one-shot seed when no position is stored. */
  sinceId: z.number().int().nonnegative().optional(),
  limit: z.number().int().min(1).max(TELEGRAM_FEED_LIMIT_MAX).optional(),
  mode: z.enum(["poll", "peek"]).optional(),
})

const cursorQuerySchema = z.object({
  workflowId: z.string().uuid(),
  nodeId: z.string().min(1).max(200),
})

/** The posts above `since`: one page, and a second one when the first was full and short of `limit` (two pages at most). */
async function fetchFreshPosts(channel: string, since: number, limit: number): Promise<TelegramChannelPost[]> {
  const first = await fetchChannelPosts(channel, { after: since })
  if (first.length < TELEGRAM_FEED_PAGE_SIZE || first.length >= limit) return first
  const second = await fetchChannelPosts(channel, { after: first[first.length - 1]!.id })
  return [...first, ...second]
}

export async function telegramChannelRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/telegram-channel/fetch", {
    // Priced as `telegram-channel-feed` everywhere it is DESCRIBED — STATIC_CREDIT_COSTS,
    // the model_pricing row, NODE_DEFINITIONS, the paid badge, the public docs.
    preHandler: creditGuard(() => "telegram-channel-feed"),
  }, async (req, reply) => {
    const userId = req.userId
    if (!userId) return reply.status(401).send({ error: { code: "unauthorized" } })

    const body = req.body as Record<string, unknown>
    const workflowId = extractWorkflowId(body)
    const nodeId = extractNodeId(body)
    const parsed = fetchSchema.safeParse(body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: parsed.error.message } })
    }
    const { channel, sinceId } = parsed.data
    const limit = parsed.data.limit ?? TELEGRAM_FEED_DEFAULT_LIMIT
    const mode = parsed.data.mode ?? "poll"
    // Stateful when the request says which node of which workflow is asking.
    const stateful = !!workflowId && !!nodeId

    if (!normalizeChannel(channel)) {
      return reply.status(400).send({
        error: { code: "validation_error", message: `"${channel}" is not a valid Telegram channel name` },
      })
    }

    // Validation rejects above cost nothing — the job row (and the reservation
    // attached to it) is only created once the request is known to be runnable.
    const { data: job, error: jobErr } = await insertJob(req, {
        user_id: userId,
        workflow_id: workflowId || null,
        status: "processing",
        input_data: buildJobInputData(parsed.data, "telegram-channel-feed"),
        provider: "telegram-channel-feed",
        job_type: "telegram-channel-feed",
      })

    if (jobErr || !job) {
      // sendInternalError leads with `jobBlockOf`, so a request-gate BLOCK
      // answers 422 `job_blocked` instead of a 500 the SDK retries with backoff (F10).
      return sendInternalError(reply, req, jobErr, "Failed to create job")
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, "telegram-channel-feed")
    if (reply.sent) return

    try {
      // Where the feed stands: the stored position (stateful poll), else the
      // editor's legacy seed; a peek stands nowhere.
      let since: number | undefined
      if (mode === "poll") {
        const stored = stateful ? await readNodeCursor(workflowId, nodeId, userId) : undefined
        since = stored ?? sinceId
      }

      let emitted: TelegramChannelPost[]
      let latestId: number | undefined
      if (mode === "peek") {
        const page = await fetchChannelPosts(channel)
        emitted = planFeedEmission(page, undefined, Math.min(limit, TELEGRAM_FEED_PEEK_MAX)).emitted
        latestId = undefined
      } else if (since === undefined) {
        const page = await fetchChannelPosts(channel)
        const plan = planFeedEmission(page, undefined, limit)
        emitted = plan.emitted
        latestId = plan.latestId
      } else {
        const fresh = await fetchFreshPosts(channel, since, limit)
        const plan = planFeedEmission(fresh, since, limit)
        emitted = plan.emitted
        latestId = plan.latestId
      }

      const advanced = mode === "poll" && latestId !== undefined && latestId !== since
      if (stateful && mode === "poll" && latestId !== undefined && advanced) {
        // Best-effort by design (node-cursor.ts): a failed write means the next
        // run re-emits, never a failed run.
        await writeNodeCursor(workflowId, nodeId, userId, "telegram-channel-feed", latestId)
      }

      const text = telegramFeedDigest(emitted)
      const position = mode === "poll" ? (latestId ?? since ?? null) : null
      const cursor = {
        /** The position after this call — null for a peek, a stateless call with nothing stored, or an empty channel. */
        lastSeenId: stateful && mode === "poll" ? position : null,
        advanced,
        mode,
        stateful,
      }
      const outputData = {
        json: emitted,
        listResults: emitted.map((p) => JSON.stringify(p)),
        text,
        generatedText: text,
        count: emitted.length,
        latestId: position,
        cursor,
      }

      await supabase
        .from("jobs")
        .update({ status: "completed", output_data: outputData })
        .eq("id", job.id)
        .eq("user_id", userId)
      // A fetch that found nothing new is not charged (decided 2026-10-05): the
      // reservation is given back and the row stays completed with count 0, so
      // a scheduled feed that polls an idle channel costs the person nothing.
      if (emitted.length === 0) await refundReservedCreditsForJob(job.id)
      else await commitReservedCreditsForJob(job.id)

      return {
        jobId: job.id,
        posts: emitted,
        latestId: position,
        text,
        generatedText: text,
        count: emitted.length,
        cursor,
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

  // The node's position, for the panel and the card ("Last seen #N · date").
  // UI-only: the SDK and MCP read the feed through the node's output.
  app.get("/v1/telegram-channel/cursor", { preHandler: requireAppScope("workflows:read") }, async (req, reply) => {
    const userId = req.userId
    if (!userId) return reply.status(401).send({ error: { code: "unauthorized" } })
    const parsed = cursorQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: parsed.error.message } })
    }
    const row = await readNodeCursorRow(parsed.data.workflowId, parsed.data.nodeId, userId)
    return { data: { lastSeenId: row?.value ?? null, updatedAt: row?.updatedAt ?? null } }
  })

  // Forget the position: the next run starts from the newest posts again.
  app.post(
    "/v1/telegram-channel/cursor/reset",
    { preHandler: requireAppScope("workflows:write"), config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const userId = req.userId
      if (!userId) return reply.status(401).send({ error: { code: "unauthorized" } })
      const parsed = cursorQuerySchema.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: { code: "validation_error", message: parsed.error.message } })
      }
      try {
        const deleted = await resetNodeCursor(parsed.data.workflowId, parsed.data.nodeId, userId)
        return { data: { ok: true, deleted } }
      } catch (err) {
        return sendInternalError(reply, req, err, "Failed to reset the feed position")
      }
    },
  )
}
