/**
 * POST /v1/site-capture — a web page captured the way a phone shows it: one
 * full-page image, up to 8 section stills and a section map.
 *
 * Always job-id-first: a capture can take up to 240 s, past the edge's ~100 s,
 * so the route answers { jobId, status: "pending" } at once and the work runs in
 * this process, as web-scrape's does (there is no worker). Callers poll
 * GET /v1/jobs/:id.
 *
 * The runner is resolved before any outbound read: "relay" (no Apify token and a
 * live nodaro.ai connection — the cloud runs the capture and its own robots.txt
 * check), "keyed" (an Apify token — robots.txt is read here first), or "none"
 * (neither — the job fails with the missing-key message and nothing leaves this
 * server). Apify loads the page, not this server, so the page address needs no
 * SSRF schema; the two fetches this server makes (robots.txt, the relay's images)
 * go through safeFetch.
 */
import type { FastifyBaseLogger, FastifyInstance } from "fastify"
import { z } from "zod"
import { insertJob } from "../lib/insert-job.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { rateLimiter } from "../middleware/rate-limit.js"
import { commitReservedCreditsForJob, refundReservedCreditsForJob } from "../lib/credits-job-lifecycle.js"
import { markJobCompletedDetailed } from "../workers/shared.js"
import { markJobFailed } from "../lib/job-failure.js"
import { extractForcePrivate, extractNodeId, extractWorkflowId } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { normalizeWebUrlInput } from "../lib/web-url-input.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { config } from "../lib/config.js"
import { isStorageConfigured } from "../lib/storage.js"
import { nodaroCloudFetch } from "../lib/nodaro-connect.js"
import { shouldRunOnCloud } from "../providers/nodaro/run-on-cloud.js"
import { createCloudJob, NodaroCloudError, waitForCloudJob } from "../providers/nodaro/client.js"
import { MissingProviderKeyError } from "../providers/provider-keys.js"
import { runSiteCapture, SiteCaptureError } from "../providers/apify/site-capture.js"
import { checkRobots, type RobotsOutcome } from "../lib/site-capture-robots.js"
import { knownCaptureCode, SITE_CAPTURE_MESSAGES, type SiteCaptureJobCode } from "../lib/site-capture-codes.js"
import { CaptureStorageFullError, deleteCaptureAssets, restoreRelayCapture, storeLocalCapture, type StoredCapture } from "../lib/site-capture-store.js"

/** How long the relay waits for the cloud's capture job. */
export const SITE_CAPTURE_RELAY_BUDGET_MS = 200_000

const webAddress = z.preprocess(normalizeWebUrlInput, z.string().url().max(2048))
const siteCaptureBody = z.object({
  url: webAddress.refine((u) => {
    try {
      return /^https?:$/.test(new URL(u).protocol)
    } catch {
      return false // the URL check above already reports it
    }
  }, "Only http and https pages can be captured"),
  maxStills: z.number().int().min(3).max(8).default(8),
})
type CaptureBody = z.infer<typeof siteCaptureBody>
type Runner = "relay" | "keyed" | "none"

/** A failure that is not the provider's own: the relay's, with the cloud's code. */
class CaptureFailure extends Error {
  constructor(readonly code: SiteCaptureJobCode, readonly publicMessage: string) {
    super(publicMessage)
    this.name = "CaptureFailure"
  }
}

const PREFLIGHT_CODE: Record<Exclude<RobotsOutcome, "allowed">, keyof typeof SITE_CAPTURE_MESSAGES> = {
  disallowed: "robots_disallowed",
  unreachable: "robots_unreachable",
  site_unreachable: "site_unreachable",
  refused_address: "validation_error",
}

async function resolveRunner(): Promise<Runner> {
  const token = config.APIFY_API_TOKEN
  if (await shouldRunOnCloud(token)) return "relay"
  return typeof token === "string" && token.trim().length > 0 ? "keyed" : "none"
}

async function cloudJobErrorCode(cloudJobId: string): Promise<unknown> {
  try {
    const res = await nodaroCloudFetch(`/v1/jobs/${cloudJobId}`)
    if (!res.ok) return undefined
    const json = (await res.json().catch(() => null)) as { data?: { output_data?: { error?: { code?: unknown } } } } | null
    return json?.data?.output_data?.error?.code
  } catch {
    return undefined
  }
}

/** The capture on the connected cloud: its output_data, the shape this route builds locally. */
async function captureViaConnection(body: CaptureBody): Promise<Record<string, unknown>> {
  let cloudJobId: string | undefined
  try {
    cloudJobId = await createCloudJob("/v1/site-capture", { ...body, respondAsync: true })
    const job = await waitForCloudJob(cloudJobId, undefined, { budgetMs: SITE_CAPTURE_RELAY_BUDGET_MS })
    return (job.output_data as Record<string, unknown> | null) ?? {}
  } catch (err) {
    if (!(err instanceof NodaroCloudError)) throw err
    if (err.message.includes("did not finish within")) throw new CaptureFailure("capture_timeout", SITE_CAPTURE_MESSAGES.capture_timeout)
    const code = cloudJobId === undefined ? err.code : await cloudJobErrorCode(cloudJobId)
    throw new CaptureFailure(knownCaptureCode(code), err.message)
  }
}

function failureOf(err: unknown): { code: SiteCaptureJobCode; message: string; providerRunId?: string } {
  if (err instanceof SiteCaptureError) return { code: err.code, message: err.publicMessage, ...(err.providerRunId ? { providerRunId: err.providerRunId } : {}) }
  if (err instanceof CaptureFailure) return { code: err.code, message: err.publicMessage }
  if (err instanceof CaptureStorageFullError) return { code: "storage_limit_exceeded", message: err.message }
  if (err instanceof MissingProviderKeyError) return { code: "capture_failed", message: err.message }
  return { code: "capture_failed", message: SITE_CAPTURE_MESSAGES.capture_failed }
}

interface SettleInput {
  jobId: string
  userId: string
  runner: Runner
  body: CaptureBody
  usageLogId: string | undefined
  log: FastifyBaseLogger
}

/** Run the capture and settle the job. Never throws: nothing awaits it. */
async function runAndSettle({ jobId, userId, runner, body, usageLogId, log }: SettleInput): Promise<void> {
  let stored: StoredCapture | null = null
  try {
    const ctx = { userId, jobId, pageUrl: body.url }
    stored =
      runner === "relay"
        ? await restoreRelayCapture(await captureViaConnection(body), ctx)
        : await storeLocalCapture(await runSiteCapture(body, log), ctx)
    const outcome = await markJobCompletedDetailed(jobId, { output_data: stored.output })
    if (outcome === "completed") {
      // The job IS completed and its result stored, so a failed commit must not
      // fall into the catch below: it is logged, and ops finds the reservation by it.
      if (usageLogId) {
        await commitReservedCreditsForJob(jobId).catch((err: unknown) => {
          log.error({ err, jobId }, "[site-capture] job completed but its reservation did not commit")
        })
      }
      return
    }
    if (outcome === "held") {
      // A result policy parked the row for review: an approval republishes the output, whose assets must exist.
      log.info({ jobId }, "[site-capture] result held for review; stills and reservation kept")
      return
    }
    // lost_race: cancelled mid-run (the cancel path refunded). blocked: the result gate failed and refunded the row.
    await deleteCaptureAssets(userId, stored.assetIds)
    log.info({ jobId, outcome }, "[site-capture] capture not completed; its stills were deleted")
  } catch (err) {
    const failure = failureOf(err)
    if (failure.code === "capture_failed" && !(err instanceof MissingProviderKeyError)) log.error({ err, jobId }, "[site-capture] capture failed")
    try {
      if (stored) await deleteCaptureAssets(userId, stored.assetIds)
      const error = { code: failure.code, message: failure.message, ...(failure.providerRunId ? { providerRunId: failure.providerRunId } : {}) }
      // Refund only when WE flipped the row: a cancelled job was refunded by the cancel path.
      const flipped = await markJobFailed(jobId, { error_message: failure.message, extra: { output_data: { error } } })
      if (flipped && usageLogId) await refundReservedCreditsForJob(jobId)
    } catch (failErr) {
      log.error({ err: failErr, jobId }, "[site-capture] failed to mark the job failed / refund")
    }
  }
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

      const runner = await resolveRunner()
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

      const { data: job, error: jobError } = await insertJob(req, {
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: buildJobInputData(parsed.data, "site-capture"),
      })
      if (jobError || !job) return sendInternalError(reply, req, jobError, "Failed to create job")

      const reservation = await reserveCreditsForJob(req, reply, job.id, "site-capture")
      if (reply.sent) return

      // respondAsync is accepted and ignored: this route never holds the request.
      reply.send({ jobId: job.id, status: "pending" })
      void runAndSettle({ jobId: job.id, userId, runner, body: parsed.data, usageLogId: reservation?.usageLogId, log: req.log })
    },
  )
}
