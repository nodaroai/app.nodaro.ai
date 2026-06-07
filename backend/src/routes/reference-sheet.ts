import type { FastifyInstance } from "fastify"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { referenceSheetBody } from "./reference-sheet.schema.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { formatZodError } from "../lib/zod-error.js"
import { referenceSheetCreditId } from "@nodaro/shared"

const TABLE: Record<string, string> = { character: "characters", object: "objects", location: "locations" }

/** The credit identifier for this sheet — motion sheets carry a higher flat
 *  FFmpeg-assembly fee than still sheets. The SAME id MUST be resolved by both
 *  the creditGuard preHandler (raw `req.body`) and reserveCreditsForJob (parsed
 *  `body`); both expose `flavour.outputFormat`, so this works on either shape.
 *  Resolving different ids at the two sites would reserve under one price and
 *  guard against another. Delegates to the shared single-source-of-truth helper. */
function sheetCreditId(body: unknown): string {
  return referenceSheetCreditId((body as { flavour?: { outputFormat?: string } })?.flavour)
}

export async function referenceSheetRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/v1/reference-sheet",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } }, preHandler: creditGuard((req) => sheetCreditId(req.body)) },
    async (req, reply) => {
      const parsed = referenceSheetBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
      }
      const body = parsed.data
      const userId = req.userId ?? body.userId
      if (!userId) return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })

      // Entity mode: IDOR-scoped ownership fetch BEFORE reserving credits.
      if (body.entityKind && body.entityDbId) {
        const { data: row } = await supabase
          .from(TABLE[body.entityKind]).select("id, source_image_url")
          .eq("id", body.entityDbId).eq("user_id", userId).is("deleted_at", null).single()
        if (!row) return reply.status(404).send({ error: { code: "not_found" } })
        if (!row.source_image_url) return reply.status(400).send({ error: { code: "main_image_required" } })
      }

      const mcpClient = extractMcpClient(req.body)
      const { data: job, error: jobErr } = await supabase
        .from("jobs")
        .insert({
          workflow_id: extractWorkflowId(req.body),
          force_private: extractForcePrivate(req.body) || undefined,
          user_id: userId,
          job_type: "reference-sheet",
          status: "pending",
          input_data: buildJobInputData(parsed.data, "reference-sheet"),
          ...(mcpClient ? { mcp_client: mcpClient } : {}),
        })
        .select("id").single()
      if (jobErr || !job) return reply.status(500).send({ error: { code: "internal_error", message: jobErr?.message ?? "job_create_failed" } })

      const reservation = await reserveCreditsForJob(req, reply, job.id, sheetCreditId(body))
      if (reply.sent) return

      await videoQueue.add("reference-sheet", { jobId: job.id, usageLogId: reservation?.usageLogId, userId, ...body })
      return reply.status(202).send({ jobId: job.id })
    },
  )
}
