import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { insertSyncJob } from "../lib/insert-job.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
// Core-safe commit/refund (keyed by job id, `ee/` reached via dynamic import) —
// this route no longer imports `ee/` at all.
import { commitReservedCreditsForJob, refundReservedCreditsForJob } from "../lib/credits-job-lifecycle.js"
import { markJobCompleted } from "../workers/shared.js"
import { markJobFailed } from "../lib/job-failure.js"
import { runScraper } from "../providers/apify/scraper.js"
import { fetchRssItems } from "../providers/rss/parser.js"
import { resolveScraperCreditId } from "@nodaro/shared"
import { extractWorkflowId, extractNodeId, extractForcePrivate, wantsJobIdFirst } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { safeUrlSchema } from "../lib/url-validator.js"
import { normalizeWebUrlInput } from "../lib/web-url-input.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { config } from "../lib/config.js"
import { shouldRunOnCloud } from "../providers/nodaro/run-on-cloud.js"
import { createCloudJob, waitForCloudJob } from "../providers/nodaro/client.js"

const ROUTE_PATH = "/v1/web-scrape"

/**
 * No Apify token of its own + a live nodaro.ai connection: the connection
 * runs the scrape (billed to the connected account) and this route relays
 * the result. RSS never needs Apify and is always fetched locally.
 *
 * The relay asks the cloud for the job id first and polls it, because the
 * cloud sits behind the same ~100 s edge timeout a browser does: held open, a
 * site crawl was cut off there while the cloud finished and billed the
 * connected account. A cloud that predates `respondAsync` ignores the flag and
 * answers when the work is done — that answer carries a `jobId` too, and the
 * poll finds the job already terminal, so a scrape UNDER the edge timeout reads
 * the same way against both generations. A longer one against such a cloud is
 * cut off exactly as it always was (this install fails and refunds its own job;
 * the connected account is still billed there) — no better, no worse.
 * The cloud job's `output_data` is the shape this route builds locally.
 */
async function scrapeViaConnection(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const cloudJobId = await createCloudJob(ROUTE_PATH, { ...body, respondAsync: true })
  const cloudJob = await waitForCloudJob(cloudJobId)
  return (cloudJob.output_data as Record<string, unknown> | null) ?? {}
}

// People type addresses the way the address bar shows them ("pletor.ai",
// "www.pletor.ai/products"); the missing scheme is inferred BEFORE the strict
// URL check so every usual spelling runs instead of failing "Invalid URL".
const webAddress = z.preprocess(normalizeWebUrlInput, z.string().url().max(2048))

const contentCrawlerBody = z.object({
  actor: z.literal("content-crawler"),
  url: webAddress,
  mode: z.enum(["page", "site"]).default("page"),
})
const googleSearchBody = z.object({
  actor: z.literal("google-search"),
  query: z.string().min(1).max(500),
  maxResults: z.number().int().min(1).max(10).optional(),
  countryCode: z.string().length(2).optional(),
})
const instagramBody = z.object({
  actor: z.literal("instagram"),
  target: webAddress,
  resultsLimit: z.number().int().min(1).max(20).optional(),
})
const tiktokBody = z.object({
  actor: z.literal("tiktok"),
  target: webAddress,
  resultsLimit: z.number().int().min(1).max(20).optional(),
})
// RSS is the only actor that doesn't go through Apify — we fetch + parse
// directly on this server, so the URL needs SSRF protection via safeUrlSchema.
const rssBody = z.object({
  actor: z.literal("rss"),
  url: z.preprocess(normalizeWebUrlInput, safeUrlSchema),
  resultsLimit: z.number().int().min(1).max(50).optional(),
})
const webScrapeBody = z.discriminatedUnion("actor", [
  contentCrawlerBody, googleSearchBody, instagramBody, tiktokBody, rssBody,
])

type ScrapeOutcome =
  | { readonly ok: true; readonly result: Record<string, unknown> }
  | { readonly ok: false; readonly status: number; readonly code: string; readonly message: string }

export async function webScrapeRoutes(app: FastifyInstance) {
  // Literal path on purpose: sync-http-route-parity.test.ts greps for it.
  app.post("/v1/web-scrape", {
    preHandler: creditGuard((req) => resolveScraperCreditId(req.body)),
    config: { requestTimeout: 600_000 } as Record<string, unknown>,
  }, async (req, reply) => {
    req.raw.setTimeout(600_000)
    reply.raw.setTimeout(600_000)

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
        input_data: buildJobInputData(parsed.data, "web-scrape"),
      })

    if (jobError || !job) {
      return sendInternalError(reply, req, jobError, "Failed to create job")
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    /**
     * Run the scrape and settle the job — the ONE body both reply modes share,
     * so what is charged and what is stored cannot differ between them.
     *
     * Never throws: in the job-id-first mode nothing awaits it, and an escaping
     * rejection there is an unhandled one. Mark-failed and the refund are
     * themselves wrapped, so a failure inside them is logged, not thrown.
     */
    const runAndSettle = async (): Promise<ScrapeOutcome> => {
      try {
        // RSS bypasses Apify entirely — a plain HTTP GET + XML parse. Keeps
        // this path off the Apify bill and cuts per-run latency ~orders
        // of magnitude.
        const result: Record<string, unknown> = parsed.data.actor === "rss"
          ? {
              json: await fetchRssItems({
                url: parsed.data.url,
                resultsLimit: parsed.data.resultsLimit,
                // A feed host answering some requests and not others is an
                // upstream incident worth seeing in the logs even when the
                // retry saves the run.
                onRetry: (info) => req.log.warn({ jobId: job.id, ...info }, "[web-scrape] rss upstream failed; retrying"),
              }),
            }
          : (await shouldRunOnCloud(config.APIFY_API_TOKEN))
            ? await scrapeViaConnection(parsed.data as Record<string, unknown>)
            : { ...(await runScraper(parsed.data)) }

        // false = the job left `pending` under us — cancelled mid-scrape, where
        // the cancel path already refunded. Settling it would charge for a run
        // the user stopped; returning the data would be a free scrape.
        const completed = await markJobCompleted(job.id, { output_data: result })
        if (!completed) {
          req.log.info({ jobId: job.id }, "[web-scrape] job left pending before completion; skipping settlement")
          return { ok: false, status: 409, code: "job_cancelled", message: "The job was cancelled before it completed." }
        }

        // The job IS completed and its result stored from here on, so a commit
        // that fails must not fall into the catch below: `markJobFailed` would
        // miss its CAS on a completed row, nothing would be refunded, and a held
        // caller would get a 502 for a scrape that is sitting on the job. The
        // reservation stays `reserved` and this line is what ops finds it by.
        if (usageLogId) {
          await commitReservedCreditsForJob(job.id).catch((commitErr: unknown) => {
            req.log.error({ err: commitErr, jobId: job.id }, "[web-scrape] job completed but its reservation did not commit")
          })
        }
        return { ok: true, result }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Scrape failed"
        try {
          // Refund only when WE flipped the row — a cancelled job was refunded by cancel.
          const flipped = await markJobFailed(job.id, { error_message: message, extra: { output_data: { error: message } } })
          if (flipped && usageLogId) await refundReservedCreditsForJob(job.id)
        } catch (failErr) {
          req.log.error({ err: failErr, jobId: job.id }, "[web-scrape] failed to mark job failed / refund")
        }
        req.log.error({ err, jobId: job.id }, "[web-scrape] scrape failed")
        return { ok: false, status: 502, code: "scrape_error", message }
      }
    }

    // Job id first: the scrape runs as detached work and the caller polls
    // GET /v1/jobs/:id. A site crawl of 20 pages measured 252 s against an
    // edge timeout of ~100 s — held open, the browser was cut off with a 524
    // while the job finished server-side and was charged, so the editor showed
    // "failed" for a run that succeeded and was paid for. Durability is
    // unchanged: the work was always in-process here; there is no worker.
    if (wantsJobIdFirst(req.body)) {
      reply.send({ jobId: job.id, status: "pending" })
      void runAndSettle()
      return
    }

    const outcome = await runAndSettle()
    if (!outcome.ok) {
      return reply.status(outcome.status).send({ error: { code: outcome.code, message: outcome.message } })
    }
    return reply.send({ jobId: job.id, ...outcome.result })
  })
}
