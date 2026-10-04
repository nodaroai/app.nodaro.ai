import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { insertJob } from "../lib/insert-job.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { commitReservedCreditsForJob, refundReservedCreditsForJob } from "../lib/credits-job-lifecycle.js"
import { commitJobCredits, markJobCompleted } from "../workers/shared.js"
import { markJobFailed } from "../lib/job-failure.js"
import { baseCreditCostFor } from "../lib/credit-base-cost.js"
import { runInstagramScrape, type InstagramPost } from "../providers/apify/instagram.js"
import { classifyAndStoreInstagramMedia, instagramWithoutMedia } from "../lib/instagram-media.js"
import { analyzeInstagramPosts } from "../lib/instagram-analysis.js"
import {
  INSTAGRAM_SCRAPE_MAX_COUNT,
  INSTAGRAM_SCRAPE_MAX_SOURCES,
  INSTAGRAM_SCRAPE_MAX_TARGET_LENGTH,
  INSTAGRAM_SCRAPE_MODES,
  INSTAGRAM_SCRAPE_NODE_TYPE,
  INSTAGRAM_SCRAPE_PERIODS,
  INSTAGRAM_SCRAPE_DEFAULT_COUNT,
  LLM_FEATURE_DEFAULTS,
  LLM_MODEL_IDS,
  META_ADS_ANALYSIS_FOCUS_MAX,
  META_ADS_FORMATS,
  STRUCTURED_VISION_MODELS,
  buildInstagramScrapeCreditId,
  clampInstagramFeaturedIndex,
  featuredInstagramOutputs,
  instagramAnalysisCreditId,
  instagramAnalysisTierFrom,
  instagramRequestedCount,
  resolveInstagramScrapeCreditId,
  splitInstagramTargets,
} from "@nodaro/shared"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { config } from "../lib/config.js"
import { shouldRunOnCloud } from "../providers/nodaro/run-on-cloud.js"
import { createCloudJob, waitForCloudJob } from "../providers/nodaro/client.js"

const ROUTE_PATH = "/v1/instagram-scrape"
const MEDIA_DEADLINE_MS = 570_000

const STRUCTURED_VISION_MODEL_IDS = new Set(STRUCTURED_VISION_MODELS.map((m) => m.id))

/**
 * No Apify token + a live nodaro.ai connection: relay the whole run (billed to
 * the connected account). The cloud route now answers with a job id and runs
 * the scrape in the background, so create the cloud job and poll it to a
 * terminal state; its `output_data` is the same shape this route builds locally.
 */
async function scrapeViaConnection(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const cloudJobId = await createCloudJob(ROUTE_PATH, body)
  const cloudJob = await waitForCloudJob(cloudJobId)
  return (cloudJob.output_data as Record<string, unknown> | null) ?? {}
}

const instagramScrapeBody = z.object({
  mode: z.enum(INSTAGRAM_SCRAPE_MODES).default("profile"),
  /** Usernames (profile), hashtags (hashtag) or post links (post), one per item; 1..5. */
  targets: z.array(z.string().trim().min(1).max(INSTAGRAM_SCRAPE_MAX_TARGET_LENGTH)).min(1).max(INSTAGRAM_SCRAPE_MAX_SOURCES),
  count: z.number().int().min(1).max(INSTAGRAM_SCRAPE_MAX_COUNT).default(INSTAGRAM_SCRAPE_DEFAULT_COUNT),
  period: z.enum(INSTAGRAM_SCRAPE_PERIODS).default("30d"),
  formats: z.array(z.enum(META_ADS_FORMATS)).max(META_ADS_FORMATS.length).optional(),
  featuredIndex: z.number().int().min(0).optional(),
  ingestVideo: z.boolean().optional(),
  ingestAllVideos: z.boolean().optional(),
  analyze: z.boolean().optional(),
  analysisModel: z
    .enum(LLM_MODEL_IDS as [string, ...string[]])
    .refine((id) => STRUCTURED_VISION_MODEL_IDS.has(id), { message: "analysisModel must be an image-capable model with structured output" })
    .optional(),
  analysisFocus: z.string().trim().max(META_ADS_ANALYSIS_FOCUS_MAX).optional(),
})

export async function instagramScrapeRoutes(app: FastifyInstance) {
  // Literal path on purpose: sync-http-route-parity.test.ts greps for it.
  app.post("/v1/instagram-scrape", {
    preHandler: creditGuard((req) => resolveInstagramScrapeCreditId(req.body)),
    config: { requestTimeout: 600_000 } as Record<string, unknown>,
  }, async (req, reply) => {
    req.raw.setTimeout(600_000)
    reply.raw.setTimeout(600_000)
    const startedAt = Date.now()

    const parsed = instagramScrapeBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    }
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }

    const parsedBody = parsed.data
    // Normalize targets ONCE (dedupe, strip @/#, cap — or, in post mode, keep
    // only canonical post links) so the guard, the reservation, the provider,
    // and the persisted input all agree on the same source set — the guard
    // resolves `sources` through the same splitter with the same mode.
    const targets = splitInstagramTargets(parsedBody.targets, parsedBody.mode)
    if (targets.length === 0) {
      const message = parsedBody.mode === "post"
        ? "No valid Instagram post links — paste links like https://www.instagram.com/p/…/"
        : "No valid Instagram targets after normalization."
      return reply.status(400).send({ error: { code: "validation_error", message } })
    }
    // A post link names one post: the format filter would only drop it.
    const body = { ...parsedBody, targets, ...(parsedBody.mode === "post" ? { formats: undefined } : {}) }
    const sources = targets.length
    const requestedCount = instagramRequestedCount(body.mode, body.count)
    const analysisTier = instagramAnalysisTierFrom(body)
    const modelIdentifier = buildInstagramScrapeCreditId({ count: requestedCount, sources, analysis: analysisTier })

    const viaCloud = await shouldRunOnCloud(config.APIFY_API_TOKEN)
    if (analysisTier && !viaCloud && !config.KIE_API_KEY && !config.ANTHROPIC_API_KEY && !config.GEMINI_API_KEY) {
      return reply.status(503).send({
        error: { code: "provider_unavailable", message: "AI analysis needs an LLM key (KIE_API_KEY, ANTHROPIC_API_KEY or GEMINI_API_KEY) — or run without analysis." },
      })
    }

    const { data: job, error: jobError } = await insertJob(req, {
      workflow_id: extractWorkflowId(req.body),
      node_id: extractNodeId(req.body),
      force_private: extractForcePrivate(req.body) || undefined,
      user_id: userId,
      status: "pending",
      input_data: buildJobInputData(body, INSTAGRAM_SCRAPE_NODE_TYPE),
    })
    if (jobError || !job) {
      return sendInternalError(reply, req, jobError, "Failed to create job")
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    // Respond with the job id NOW and run the scrape as detached background
    // work. A real profile scrape + media copy routinely runs past Cloudflare's
    // ~100s edge timeout (a completed 20-post run measured ~176s), which would
    // 524 the browser while the job actually finished and was charged. Every
    // caller polls GET /v1/jobs/:id instead: the orchestrator already does
    // (node-executor branches on `jobId`), and the editor's single-node Run and
    // the cloud relay now poll too. Durability is unchanged — the work was
    // always in-process here; there is no worker either way.
    reply.send({ jobId: job.id, status: "pending" })

    void (async () => {
      try {
        const scraped = viaCloud
          ? await scrapeViaConnection(body as Record<string, unknown>)
          : await runInstagramScrape(body)

        const scrapedPosts = (Array.isArray(scraped.json) ? scraped.json : []) as InstagramPost[]
        const featuredIndex = clampInstagramFeaturedIndex(body.featuredIndex, scrapedPosts.length)
        const media = await classifyAndStoreInstagramMedia(scrapedPosts, {
          userId,
          jobId: job.id,
          deadlineAt: startedAt + MEDIA_DEADLINE_MS,
          storeImages: !viaCloud,
          storeFeaturedVideoIndex: body.ingestVideo && !viaCloud ? featuredIndex : undefined,
          storeAllVideos: body.ingestAllVideos === true && !viaCloud,
          formats: body.formats,
        }).catch((err: unknown) => {
          req.log.warn({ err, jobId: job.id }, "[instagram-scrape] media step failed; returning posts with their source urls")
          return { posts: instagramWithoutMedia(scrapedPosts), stats: { classified: 0, stored: 0, videosStored: 0, kept: scrapedPosts.length, filteredOut: 0 } }
        })

        const analysisModel = body.analysisModel ?? LLM_FEATURE_DEFAULTS["meta-ads-analysis"]
        const analyzed = analysisTier && !viaCloud
          ? await analyzeInstagramPosts(media.posts, { modelId: analysisModel, focus: body.analysisFocus, deadlineAt: startedAt + MEDIA_DEADLINE_MS })
          : null
        const posts = analyzed ? analyzed.posts : media.posts
        const relayedAnalysis = (scraped as Record<string, unknown>).analysis
        const analysisStats = analyzed
          ? { model: analysisModel, ...analyzed.stats }
          : viaCloud && relayedAnalysis && typeof relayedAnalysis === "object" ? relayedAnalysis : undefined

        const result = {
          json: posts,
          mediaStorage: media.stats,
          ...(analysisStats ? { analysis: analysisStats } : {}),
          ...featuredInstagramOutputs(posts, featuredIndex),
        }

        const completed = await markJobCompleted(job.id, {
          output_data: result,
          ...(analyzed ? { provider_cost: analyzed.stats.providerCostUsd || null } : {}),
        })
        if (!completed) {
          // Cancelled mid-scrape — the refund is the cancel endpoint's job, not
          // ours; never settle a cancelled reservation.
          req.log.info({ jobId: job.id }, "[instagram-scrape] job cancelled before completion; skipping settlement")
          return
        }

        if (usageLogId) {
          if (analyzed && analysisTier) {
            const [scrapeBase, perPost] = await Promise.all([
              baseCreditCostFor(buildInstagramScrapeCreditId({ count: requestedCount, sources })),
              baseCreditCostFor(instagramAnalysisCreditId(analysisTier)),
            ])
            await commitJobCredits(usageLogId, job.id, null, scrapeBase + perPost * analyzed.stats.analyzed, true)
          } else {
            await commitReservedCreditsForJob(job.id)
          }
        }
      } catch (err) {
        // The detached body must never throw: an escaping rejection is an
        // unhandled promise rejection. Mark-failed + refund are themselves
        // wrapped so a failure there is logged, not thrown.
        const message = err instanceof Error ? err.message : "Scrape failed"
        try {
          const flipped = await markJobFailed(job.id, { error_message: message, extra: { output_data: { error: message } } })
          if (flipped && usageLogId) await refundReservedCreditsForJob(job.id)
        } catch (failErr) {
          req.log.error({ err: failErr, jobId: job.id }, "[instagram-scrape] failed to mark job failed / refund")
        }
        req.log.error({ err, jobId: job.id }, "[instagram-scrape] scrape failed")
      }
    })()
  })
}
