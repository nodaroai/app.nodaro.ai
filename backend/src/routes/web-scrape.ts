import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { CreditsService } from "../ee/billing/credits.js"
import { runScraper } from "../providers/apify/scraper.js"
import { fetchRssItems } from "../providers/rss/parser.js"
import { resolveScraperCreditId } from "@nodaro/shared"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { safeUrlSchema } from "../lib/url-validator.js"
import { formatZodError } from "../lib/zod-error.js"

const contentCrawlerBody = z.object({
  actor: z.literal("content-crawler"),
  url: z.string().url().max(2048),
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
  target: z.string().url().max(2048),
  resultsLimit: z.number().int().min(1).max(20).optional(),
})
const tiktokBody = z.object({
  actor: z.literal("tiktok"),
  target: z.string().url().max(2048),
  resultsLimit: z.number().int().min(1).max(20).optional(),
})
// RSS is the only actor that doesn't go through Apify — we fetch + parse
// directly on this server, so the URL needs SSRF protection via safeUrlSchema.
const rssBody = z.object({
  actor: z.literal("rss"),
  url: safeUrlSchema,
  resultsLimit: z.number().int().min(1).max(50).optional(),
})
const webScrapeBody = z.discriminatedUnion("actor", [
  contentCrawlerBody, googleSearchBody, instagramBody, tiktokBody, rssBody,
])

export async function webScrapeRoutes(app: FastifyInstance) {
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

    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .insert({
        workflow_id: extractWorkflowId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: buildJobInputData(parsed.data, "web-scrape"),
      })
      .select("id")
      .single()

    if (jobError || !job) {
      return reply.status(500).send({ error: { code: "internal_error", message: jobError?.message ?? "job insert failed" } })
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    try {
      // RSS bypasses Apify entirely — a plain HTTP GET + XML parse. Keeps
      // this path off the Apify bill and cuts per-run latency ~orders
      // of magnitude.
      const result = parsed.data.actor === "rss"
        ? { json: await fetchRssItems({ url: parsed.data.url, resultsLimit: parsed.data.resultsLimit }) }
        : await runScraper(parsed.data)

      await supabase.from("jobs").update({
        status: "completed",
        output_data: result,
      }).eq("id", job.id)

      if (usageLogId) await CreditsService.commitCredits(usageLogId)

      return reply.send({ jobId: job.id, ...result })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Scrape failed"
      // tenant-scope-ignore: job.id is server-generated in this request
      await supabase.from("jobs").update({ status: "failed", output_data: { error: message } }).eq("id", job.id)
      if (usageLogId) await CreditsService.refundCredits(usageLogId)
      return reply.status(502).send({ error: { code: "scrape_error", message } })
    }
  })
}
