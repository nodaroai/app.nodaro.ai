/**
 * fal.ai Topaz Rhea video upscale — `topaz/upscale/video/precision` with
 * `model: "Rhea"`. Flat function called by the `video-upscale` worker branch
 * for provider `topaz-rhea` (mirroring `fal/video-depth.ts`).
 *
 * The request sends exactly what the route (or the workflow run) planned:
 * the clip, Rhea, the factor that brings the short side to the target
 * (`@nodaro/render-rules` topazRheaUpscaleFactor), and H.264 output (a codec
 * every browser plays, so the delivery uploads it as delivered). `target_fps`
 * is never sent (the source's own rate is kept), nor the enhancement knobs
 * (compression, noise, halo, grain, recover_detail: the model's defaults).
 * `enable_safety_checker` is a declared lever, applied by the one chokepoint
 * (`applyProviderSafety`): not sent today (the provider's default, on), and
 * never loosened — the model always takes a video, which a text check cannot see.
 *
 * `FAL_TOPAZ_RHEA_CONFIGS` is also read by `lib/reconcile/fal.ts` to recover
 * the endpoint of a stuck row from its `input_data.provider`.
 */
import { TOPAZ_RHEA_VIDEO_UPSCALE_PROVIDER, type TopazVideoResolution } from "@nodaro/shared/models"
import { runFalRequest, extractFalUrl, FalRequestError, FalSubmitAmbiguousError } from "./client.js"
import { ProviderRunPendingError } from "../../lib/provider-run-pending.js"
import { falCostUsd } from "./pricing.js"
import type { ReconcileOpts } from "../provider.interface.js"
import type { ProviderKeyCoverage } from "../provider-keys.js"
import { applyProviderSafety } from "../../lib/provider-safety.js"
import type { SafetyLever } from "../safety-levers.js"
import type { ProviderSafetyEntry } from "../kie/models.js"
import { assertLinkImportAllowed } from "../../lib/link-imports.js"
import { TOPAZ_RHEA_MAX_WAIT_MS } from "../../lib/topaz-rhea-timeouts.js"

export const FAL_TOPAZ_RHEA_ENDPOINT = "topaz/upscale/video/precision"

/** The model the endpoint runs (it serves several Topaz models). */
export const FAL_TOPAZ_RHEA_MODEL = "Rhea"

export const FAL_TOPAZ_RHEA_CONFIGS: Record<string, { endpoint: string; safetyLevers: readonly SafetyLever[] }> = {
  [TOPAZ_RHEA_VIDEO_UPSCALE_PROVIDER]: {
    endpoint: FAL_TOPAZ_RHEA_ENDPOINT,
    // Always takes a video (a text check cannot see it): never loosened.
    safetyLevers: [{ kind: "boolean", param: "enable_safety_checker", filterOnValue: true, shipped: null, providerDefault: true, neverLoosen: true }],
  },
}

/** No nodaro.ai connection runs this lane: the missing-key message must not offer one. */
export const TOPAZ_RHEA_KEY_COVERAGE: ProviderKeyCoverage = { coveredByConnection: false }

/**
 * How many status reads the worker makes on the request: 60 minutes at the
 * client's 3 s cadence. The wait is also bounded by wall clock
 * (`TOPAZ_RHEA_MAX_WAIT_MS`, the figure the reconcile's `fal-rhea` threshold
 * is derived from), so slow status reads cannot stretch it past that
 * threshold. A run still going after it is left to the reconcile, which reads
 * the same request.
 */
export const TOPAZ_RHEA_MAX_POLLS = 1200

/** The exact input a run sends, before the safety chokepoint. */
export function topazRheaRequestInput(videoUrl: string, upscaleFactor: number): Record<string, unknown> {
  return {
    video_url: videoUrl,
    model: FAL_TOPAZ_RHEA_MODEL,
    upscale_factor: upscaleFactor,
    H264_output: true,
  }
}

/**
 * Run one Topaz Rhea upscale. Returns the output URL and the provider's cost
 * in USD for the admin, from fal's listed per-second rate for the target over
 * the billed seconds (the queue result carries no billed figure). Display and
 * anomaly only: the charge is the reserved row × billed seconds.
 */
export async function falTopazRheaUpscale(opts: {
  videoUrl: string
  upscaleFactor: number
  target: TopazVideoResolution
  billedSec: number
  reconcileOpts?: ReconcileOpts
  /** A request this job already submitted (a retry, a stall re-pick): polled, never submitted again. */
  resumeRequestId?: string
  /** Told a NEW request's id right after submit, before any poll: the worker keeps it on the job for a retry. */
  onSubmitted?: (requestId: string) => Promise<void>
  /** Poll cadence override (ms); tests pass 0. */
  pollIntervalMs?: number
}): Promise<{ url: string; cost: number | null; providerMs: number; requestId: string }> {
  // The route and the workflow run refused an outside link where link imports
  // are off; a job queued before the switch was turned off is refused here.
  assertLinkImportAllowed(opts.videoUrl)
  const cfg = FAL_TOPAZ_RHEA_CONFIGS[TOPAZ_RHEA_VIDEO_UPSCALE_PROVIDER]!
  const started = Date.now()
  // Whether this attempt submitted a request (a wait that gives up after it leaves a running request).
  let submittedSeen = false
  let ran: { output: unknown; requestId: string }
  try {
    ran = await runFalRequest({
      endpoint: cfg.endpoint,
      input: await applyProviderSafety(topazRheaSafetyEntry(), topazRheaRequestInput(opts.videoUrl, opts.upscaleFactor)),
      label: "[fal:topazRhea]",
      reconcileOpts: opts.reconcileOpts,
      keyCoverage: TOPAZ_RHEA_KEY_COVERAGE,
      maxPolls: TOPAZ_RHEA_MAX_POLLS,
      maxWaitMs: TOPAZ_RHEA_MAX_WAIT_MS,
      statusErrorRetries: TOPAZ_RHEA_STATUS_ERROR_RETRIES,
      // One submit is one billed run: the SDK must not re-send it after an outcome it cannot read.
      submitOnce: true,
      ...(opts.resumeRequestId ? { resumeRequestId: opts.resumeRequestId } : {}),
      onSubmitted: async (requestId: string) => {
        submittedSeen = true
        await opts.onSubmitted?.(requestId)
      },
      ...(opts.pollIntervalMs !== undefined ? { pollIntervalMs: opts.pollIntervalMs } : {}),
    })
  } catch (err) {
    // The wait ran out, or the status kept failing to read, with a request
    // submitted: it may still be running. Left to the recovery, never started again.
    if (isWaitGivenUp(err) && (opts.resumeRequestId || submittedSeen)) {
      throw new ProviderRunPendingError("The upscale is still running; it will be checked again.", { cause: err })
    }
    throw err
  }
  return {
    url: extractFalUrl(ran.output),
    cost: topazRheaCostUsd(opts.target, opts.billedSec),
    providerMs: Date.now() - started,
    requestId: ran.requestId,
  }
}

/** Status reads that may fail in a row (a blip) before the wait gives up and leaves the run to the recovery. */
export const TOPAZ_RHEA_STATUS_ERROR_RETRIES = 5

/**
 * A wait that gave up without fal's answer: the poll budget ran out (a plain
 * "timed out after N polls"), or the status reads kept failing (no
 * FalRequestError, which is fal's own failure answer).
 */
function isWaitGivenUp(err: unknown): boolean {
  if (err instanceof FalRequestError) return false
  if (err instanceof FalSubmitAmbiguousError) return false
  if ((err as { code?: unknown } | null)?.code === "provider_key_missing") return false
  return true
}

/** fal's bill for a run, in USD, from its listed rate for the target (null for a target with no listed rate). */
export function topazRheaCostUsd(target: TopazVideoResolution, billedSec: number): number | null {
  return falCostUsd(`${TOPAZ_RHEA_VIDEO_UPSCALE_PROVIDER}:${target}`, { seconds: billedSec })
}

/** Topaz Rhea's content-filter entry, as the admin page and the chokepoint read it. */
export function topazRheaSafetyEntries(): readonly ProviderSafetyEntry[] {
  return Object.entries(FAL_TOPAZ_RHEA_CONFIGS).map(([modelId, cfg]) => ({ modelId, wireModel: cfg.endpoint, levers: cfg.safetyLevers }))
}

function topazRheaSafetyEntry(): ProviderSafetyEntry | null {
  return topazRheaSafetyEntries()[0] ?? null
}
