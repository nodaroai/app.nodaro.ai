import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { fetchChannelPosts, normalizeChannel } from "../services/social/telegram-channel.js"
import { sendInternalError } from "../lib/http-errors.js"

/**
 * Telegram Channel Feed — reads a PUBLIC channel's recent posts for
 * rewrite/repost workflows. The node calls this at runtime (sync-HTTP).
 *
 * Dedup across scheduled runs is cursor-based and STATELESS on the server:
 * the caller passes `sinceId` (the highest post id it saw last run) and gets
 * back only newer posts plus the new `latestId` to persist. This keeps the
 * endpoint a pure function of its inputs — no per-node table — and the node's
 * saved data carries the cursor.
 */

const schema = z.object({
  channel: z.string().min(1),
  sinceId: z.number().int().nonnegative().optional(),
  limit: z.number().int().min(1).max(20).optional(),
})

export async function telegramChannelRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/telegram-channel/fetch", async (req, reply) => {
    if (!req.userId) return reply.status(401).send({ error: { code: "unauthorized" } })

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
      return {
        posts: capped,
        latestId,
        text: joined,
        generatedText: joined,
        count: capped.length,
      }
    } catch (err) {
      // User-facing channel errors (private/invalid/preview-off) are 400s, not
      // 500s — surface the clear message from the scraper.
      const message = err instanceof Error ? err.message : "Failed to read channel"
      if (/valid Telegram channel|private, doesn't exist|preview disabled|Could not read/.test(message)) {
        return reply.status(400).send({ error: { code: "channel_error", message } })
      }
      return sendInternalError(reply, req, err, "Failed to read Telegram channel")
    }
  })
}
