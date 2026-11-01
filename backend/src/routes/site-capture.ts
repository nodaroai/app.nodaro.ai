/**
 * POST /v1/site-capture — a web page captured the way a phone shows it: one
 * full-page image, up to 8 section stills and a section map.
 *
 * Always job-id-first: a capture can take up to 240 s, past the edge's ~100 s,
 * so the route answers { jobId, status: "pending" } at once and the capture
 * runs as the `site-capture` video-worker job (lib/background-scrape/
 * site-capture.ts). Callers poll GET /v1/jobs/:id.
 *
 * The runner is resolved here, before any outbound read: "relay" (no Apify
 * token and a live nodaro.ai connection — the cloud runs the capture and its
 * own robots.txt check), "keyed" (an Apify token — robots.txt is read here
 * first), or "none" (neither — the job fails with the missing-key message and
 * nothing leaves this server).
 */
import type { FastifyInstance } from "fastify"
import { insertSyncJob } from "../lib/insert-job.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { rateLimiter } from "../middleware/rate-limit.js"
import { extractForcePrivate, extractNodeId, extractWorkflowId } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { isStorageConfigured } from "../lib/storage.js"
import { checkRobots, type RobotsOutcome } from "../lib/site-capture-robots.js"
import { SITE_CAPTURE_MESSAGES } from "../lib/site-capture-codes.js"
import {
  resolveSiteCaptureRunner,
  SITE_CAPTURE_JOB_TYPE,
  siteCaptureBody,
  type SiteCaptureJobData,
} from "../lib/background-scrape/site-capture.js"
import { enqueueBackgroundScrape } from "../lib/background-scrape/enqueue.js"

const PREFLIGHT_CODE: Record<Exclude<RobotsOutcome, "allowed">, keyof typeof SITE_CAPTURE_MESSAGES> = {
  disallowed: "robots_disallowed",
  unreachable: "robots_unreachable",
  site_unreachable: "site_unreachable",
  refused_address: "validation_error",
}

export async function siteCaptureRoutes(app: FastifyInstance) {
  app.post(
    "/v1/site-capture",
    {
      // The limiter first, so a flood is refused before any balance read; fail closed (a spend route).
      preHandler: [rateLimiter({ windowMs: 60_000, max: 10, keyPrefix: "site-capture", failClosed: true }), creditGuard(() => "site-capture")],
    },
    async (req, reply) => {
      const parsed = siteCaptureBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
      }
      const userId = req.userId
      if (!userId) {
        return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
      }

      const runner = await resolveSiteCaptureRunner()
      if (runner === "keyed") {
        if (!isStorageConfigured()) {
          return reply.status(422).send({ error: { code: "storage_not_configured", message: SITE_CAPTURE_MESSAGES.storage_not_configured } })
        }
        const robots = await checkRobots(parsed.data.url)
        if (robots !== "allowed") {
          const code = PREFLIGHT_CODE[robots]
          return reply.status(422).send({ error: { code, message: SITE_CAPTURE_MESSAGES[code] } })
        }
      }

      const { data: job, error: jobError } = await insertSyncJob(req, {
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: buildJobInputData(parsed.data, SITE_CAPTURE_JOB_TYPE),
      })
      if (jobError || !job) return sendInternalError(reply, req, jobError, "Failed to create job")

      const reservation = await reserveCreditsForJob(req, reply, job.id, "site-capture")
      if (reply.sent) return

      // respondAsync is accepted and ignored: this route never holds the request.
      const data: SiteCaptureJobData = {
        jobId: job.id, userId, billingContext: req.billingContext, usageLogId: reservation?.usageLogId, body: parsed.data, runner,
      }
      return enqueueBackgroundScrape(req, reply, SITE_CAPTURE_JOB_TYPE, { ...data })
    },
  )
}
