import type { FastifyInstance } from "fastify"
import { insertSyncJob } from "../lib/insert-job.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { resolveScraperCreditId } from "@nodaro/shared/social"
import { extractWorkflowId, extractNodeId, extractForcePrivate, wantsJobIdFirst } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { extendSocketTimeout } from "../lib/llm-route-timeout.js"
import { laneGuard } from "../lib/concurrency-lanes/request-scope.js"
import { syncRouteLane } from "../lib/concurrency-lanes/sync-route-lanes.js"
import { settleWebScrape, WEB_SCRAPE_JOB_TYPE, webScrapeBody, type WebScrapeJobData } from "../lib/background-scrape/web-scrape.js"
import { enqueueBackgroundScrape } from "../lib/background-scrape/enqueue.js"
import { scrapeRunTracker } from "../lib/background-scrape/scrape-run.js"

export async function webScrapeRoutes(app: FastifyInstance) {
  // Literal path on purpose: sync-http-route-parity.test.ts greps for it.
  app.post("/v1/web-scrape", {
    preHandler: [
      creditGuard((req) => resolveScraperCreditId(req.body)),
      // The lane last: a synchronous scrape waits for its slot before the
      // handler reserves. A job-id-first request answers at once and takes
      // none, and an RSS feed is a plain fetch here, not provider work.
      laneGuard(...syncRouteLane("/v1/web-scrape")),
    ],
    config: { requestTimeout: 600_000 } as Record<string, unknown>,
  }, async (req, reply) => {
    extendSocketTimeout(req, reply, 600_000)

    const parsed = webScrapeBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }

    const modelIdentifier = resolveScraperCreditId(req.body)

    const { data: job, error: jobError } = await insertSyncJob(req, {
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: buildJobInputData(parsed.data, WEB_SCRAPE_JOB_TYPE),
      })

    if (jobError || !job) {
      return sendInternalError(reply, req, jobError, "Failed to create job")
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    // Job id first: the scrape runs as the `web-scrape` video-worker job and
    // the caller polls GET /v1/jobs/:id. A site crawl of 20 pages measured
    // 252 s against an edge timeout of ~100 s — held open, the browser was cut
    // off with a 524 while the job finished server-side and was charged. On
    // the worker it survives a deploy, and waits for its slot there.
    if (wantsJobIdFirst(req.body)) {
      const data: WebScrapeJobData = { jobId: job.id, userId, billingContext: req.billingContext, usageLogId, body: parsed.data }
      return enqueueBackgroundScrape(req, reply, WEB_SCRAPE_JOB_TYPE, { ...data })
    }

    // Synchronous: the scrape runs in the request, under the slot its
    // laneGuard took — the same settle the worker job runs.
    const outcome = await settleWebScrape({ jobId: job.id, usageLogId, body: parsed.data, runs: scrapeRunTracker(job.id), log: req.log })
    if (!outcome.ok) {
      return reply.status(outcome.status).send({ error: { code: outcome.code, message: outcome.message } })
    }
    return reply.send({ jobId: job.id, ...outcome.result })
  })
}
