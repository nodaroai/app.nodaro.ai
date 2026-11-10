import type { FastifyInstance } from "fastify"
import { insertSyncJob } from "../lib/insert-job.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { POST_CONTENT_ANALYSIS_SYSTEM_PROMPT } from "@nodaro/prompts/doctrine"
import { adCreativeAnalysisPlannedCall } from "../lib/ad-creative-analysis.js"
import { reserveFixedPlusLlmCalls, type FixedPlusLlmHold } from "../lib/llm-fixed-plus-calls.js"
import {
  buildInstagramScrapeCreditId,
  instagramAnalysisTierFrom,
  instagramRequestedCount,
  resolveInstagramScrapeCreditId,
  splitInstagramTargets,
} from "@nodaro/shared/social"
import { LLM_FEATURE_DEFAULTS } from "@nodaro/shared/llm-models"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { config, llmMeteredPricing } from "../lib/config.js"
import { adAnalysisRunModel } from "../lib/run-model.js"
import { shouldRunOnCloud } from "../providers/nodaro/run-on-cloud.js"
import { INSTAGRAM_SCRAPE_JOB_TYPE, instagramScrapeBody, type InstagramScrapeJobData } from "../lib/background-scrape/instagram.js"
import { enqueueBackgroundScrape } from "../lib/background-scrape/enqueue.js"

export async function instagramScrapeRoutes(app: FastifyInstance) {
  // Literal path on purpose: sync-http-route-parity.test.ts greps for it.
  app.post("/v1/instagram-scrape", {
    preHandler: creditGuard((req) => resolveInstagramScrapeCreditId(req.body), { runModel: adAnalysisRunModel }),
  }, async (req, reply) => {
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

    // The model the per-item analysis runs, when one is asked for (resolved before
    // the row so the row records it).
    const analysisModel = body.analysisModel ?? LLM_FEATURE_DEFAULTS["meta-ads-analysis"]
    const { data: job, error: jobError } = await insertSyncJob(req, {
      workflow_id: extractWorkflowId(req.body),
      node_id: extractNodeId(req.body),
      force_private: extractForcePrivate(req.body) || undefined,
      user_id: userId,
      status: "pending",
      input_data: { ...buildJobInputData(body, INSTAGRAM_SCRAPE_JOB_TYPE), ...(analysisTier !== null ? { resolvedModel: analysisModel } : {}) },
    })
    if (jobError || !job) {
      return sendInternalError(reply, req, jobError, "Failed to create job")
    }

    // Per-post analysis bills METERED (B5), under meta-ads-analysis:<model>
    // (the analysis feature both scrapes share): the scrape keeps its fixed
    // price and each requested post's analysis is held at one call's 1-attempt
    // hold, all in ONE reservation; the settle charges the scrape plus what the
    // analyses cost. Under the rollback — and for a cloud relay, whose
    // connected account runs and bills the analysis — the run reserves its
    // tier id exactly as before.
    const meteredAnalysis = analysisTier !== null && !viaCloud && llmMeteredPricing()
    let analysisHold: FixedPlusLlmHold | undefined
    let usageLogId: string | undefined
    if (meteredAnalysis) {
      const requestedPosts = Math.max(1, requestedCount * sources)
      // Held at the typical per-post cost × the posts requested (D12); the
      // actual is collected at the settle. The planned call (one post's request)
      // makes the model fail closed when a lane it may use has no rate.
      const planned = adCreativeAnalysisPlannedCall({ modelId: analysisModel, focus: body.analysisFocus, systemPrompt: POST_CONTENT_ANALYSIS_SYSTEM_PROMPT })
      analysisHold = await reserveFixedPlusLlmCalls(req, reply, job.id, {
        fixedId: buildInstagramScrapeCreditId({ count: requestedCount, sources }),
        feature: "meta-ads-analysis",
        modelId: analysisModel,
        items: requestedPosts,
        plannedRequest: planned.request,
      })
      if (!analysisHold) return
      usageLogId = analysisHold.usageLogId
    } else {
      const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
      if (reply.sent) return
      usageLogId = reservation?.usageLogId
    }

    // Respond with the job id NOW: the scrape runs as the
    // `instagram-scrape` video-worker job. A real profile scrape + media copy
    // routinely runs past Cloudflare's ~100s edge timeout (a completed 20-post
    // run measured ~176s). Every caller polls GET /v1/jobs/:id: the
    // orchestrator does (node-executor branches on `jobId`), and so do the
    // editor's single-node Run and the cloud relay. On the worker the scrape
    // survives a deploy, waits for its slot there, and its analysis runs
    // under that slot.
    const data: InstagramScrapeJobData = {
      jobId: job.id, userId, billingContext: req.billingContext, usageLogId,
      body, viaCloud, requestedCount, sources, analysisTier, analysisModel,
      ...(analysisHold ? { analysisHold } : {}),
    }
    return enqueueBackgroundScrape(req, reply, INSTAGRAM_SCRAPE_JOB_TYPE, { ...data })
  })
}
