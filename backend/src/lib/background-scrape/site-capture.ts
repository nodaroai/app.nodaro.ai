/**
 * Site Capture: what a capture is (its body), who runs it (its runner), and
 * its settle — run by the `site-capture` video-worker job (the route always
 * answers with a job id; it has no synchronous mode).
 *
 * The runner is resolved by the route before any outbound read: "relay" (no
 * Apify token and a live nodaro.ai connection — the cloud runs the capture and
 * its own robots.txt check), "keyed" (an Apify token — robots.txt is read there
 * first), or "none" (neither — the job fails with the missing-key message and
 * nothing leaves this server). Apify loads the page, not this server, so the
 * page address needs no SSRF schema; the two fetches this server makes
 * (robots.txt, the relay's images) go through safeFetch.
 */
import { z } from "zod"
import { markJobCompletedDetailed } from "../../workers/shared.js"
import { markJobFailed } from "../job-failure.js"
import { commitReservedCreditsForJob, refundReservedCreditsForJob } from "../credits-job-lifecycle.js"
import { normalizeWebUrlInput } from "../web-url-input.js"
import { config } from "../config.js"
import { nodaroCloudFetch } from "../nodaro-connect.js"
import { shouldRunOnCloud } from "../../providers/nodaro/run-on-cloud.js"
import { createCloudJob, NodaroCloudError, waitForCloudJob } from "../../providers/nodaro/client.js"
import { MissingProviderKeyError } from "../../providers/provider-keys.js"
import { runSiteCapture, SiteCaptureError, type SiteCaptureRun } from "../../providers/apify/site-capture.js"
import { knownCaptureCode, SITE_CAPTURE_MESSAGES, type SiteCaptureJobCode } from "../site-capture-codes.js"
import { CaptureStorageFullError, deleteCaptureAssets, restoreRelayCapture, storeLocalCapture, type StoredCapture } from "../site-capture-store.js"
import type { BackgroundScrapeJobBase, ScrapeLog } from "./common.js"
import { apifyRunHooks, cloudJobOf, type ScrapeRunTracker } from "./scrape-run.js"

export { SITE_CAPTURE_JOB_TYPE } from "./job-types.js"

/** How long the relay waits for the cloud's capture job. */
export const SITE_CAPTURE_RELAY_BUDGET_MS = 200_000

const webAddress = z.preprocess(normalizeWebUrlInput, z.string().url().max(2048))
export const siteCaptureBody = z.object({
  url: webAddress.refine((u) => {
    try {
      return /^https?:$/.test(new URL(u).protocol)
    } catch {
      return false // the URL check above already reports it
    }
  }, "Only http and https pages can be captured"),
  maxStills: z.number().int().min(3).max(8).default(8),
})
export type CaptureBody = z.infer<typeof siteCaptureBody>
export type SiteCaptureRunner = "relay" | "keyed" | "none"

export async function resolveSiteCaptureRunner(): Promise<SiteCaptureRunner> {
  const token = config.APIFY_API_TOKEN
  if (await shouldRunOnCloud(token)) return "relay"
  return typeof token === "string" && token.trim().length > 0 ? "keyed" : "none"
}

/** The `site-capture` worker job's payload. */
export interface SiteCaptureJobData extends BackgroundScrapeJobBase {
  readonly body: CaptureBody
  readonly runner: SiteCaptureRunner
}

/** A failure that is not the provider's own: the relay's, with the cloud's code. */
class CaptureFailure extends Error {
  constructor(readonly code: SiteCaptureJobCode, readonly publicMessage: string) {
    super(publicMessage)
    this.name = "CaptureFailure"
  }
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

/** The capture on the connected cloud: its output_data, the shape this module builds locally. */
async function captureViaConnection(body: CaptureBody, runs: ScrapeRunTracker): Promise<Record<string, unknown>> {
  let cloudJobId: string | undefined
  try {
    cloudJobId = await cloudJobOf(runs, (idempotencyKey) => createCloudJob("/v1/site-capture", { ...body, respondAsync: true }, { idempotencyKey }))
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

export interface SiteCaptureSettleInput {
  readonly jobId: string
  readonly userId: string
  readonly runner: SiteCaptureRunner
  readonly body: CaptureBody
  readonly usageLogId: string | undefined
  /** The run this job already started (re-attach), and where a new one is saved. */
  readonly runs: ScrapeRunTracker
  readonly log: ScrapeLog
}

/**
 * Run the capture and settle the job. Never throws: the worker job must not
 * be retried for a capture that failed (a retry would run — and bill — the
 * provider again).
 */
export async function settleSiteCapture({ jobId, userId, runner, body, usageLogId, runs, log }: SiteCaptureSettleInput): Promise<void> {
  let stored: StoredCapture | null = null
  // The Apify run's storages are deleted only once the job's own row has
  // settled and its reservation was committed or refunded — the `finally`
  // below, on every path: until then a re-attached attempt (an interruption)
  // re-reads them, and nothing widens the gap between the completion and its
  // commit. The delete is best-effort and never throws.
  let captured: SiteCaptureRun | null = null
  try {
    const ctx = { userId, jobId, pageUrl: body.url }
    if (runner === "relay") {
      stored = await restoreRelayCapture(await captureViaConnection(body, runs), ctx)
    } else {
      captured = await runSiteCapture(body, log, apifyRunHooks(runs))
      stored = await storeLocalCapture(captured, ctx)
    }
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
  } finally {
    await captured?.deleteStorages()
  }
}
