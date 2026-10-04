import { dubbingModelIdentifier } from "./dubbing-model.js"
import { probeMediaDuration } from "../providers/video/ffmpeg-utils.js"
import { validateProjectDubbing } from "../providers/elevenlabs/dubbing-project.js"
import { DUBBING_MAX_DURATION_SEC } from "../providers/elevenlabs/dubbing.js"
import { getAppSettings } from "./app-settings.js"
import { hasCredits } from "./config.js"
import { dubbingBaseCredits, dubbingReservePlan, effectiveDubbedSeconds, measureDubbingSourceSec } from "./dubbing-duration.js"

/** A dub the route would refuse, refused before a workflow run reserves anything. */
export interface DubbingRefusal {
  readonly code: "media_duration_exceeds_limit"
  readonly message: string
}

/**
 * The workflow run's twin of the route's preHandler, for every language but
 * Hebrew (whose project lane probes in `projectDubbingCreditOverride`).
 * Measures the source the payload will send (an upload, or a link through the
 * social-post probe — lib/dubbing-duration.ts), applies the start/end window,
 * and stamps what the reservation and delivery read: `probedDurationSec` when
 * the span is known, `reservedCeiling` when it is not (held at 30 minutes,
 * settled to the span dubbed at delivery).
 *
 * The caller must run it BEFORE writing input_data: the reconcile lane, which
 * delivers long dubs, reads the stamp from the jobs row. Only where credits are
 * charged — the length prices the run. Returns the route's refusal for a span
 * past 30 minutes; undefined otherwise, and for any other job.
 */
export async function stampDubbingDuration(
  jobName: string,
  payload: Record<string, unknown>,
): Promise<DubbingRefusal | undefined> {
  if (jobName !== "dubbing" || !hasCredits()) return undefined
  if (dubbingModelIdentifier(payload.targetLanguage) === "elevenlabs-dubbing-v2") return undefined
  const mediaUrl = typeof payload.videoUrl === "string" && payload.videoUrl
    ? payload.videoUrl
    : typeof payload.audioUrl === "string" && payload.audioUrl ? payload.audioUrl : undefined
  const sourceUrl = !mediaUrl && typeof payload.sourceUrl === "string" && payload.sourceUrl ? payload.sourceUrl : undefined
  const probedSec = await measureDubbingSourceSec({ mediaUrl, sourceUrl }, (err) => {
    console.warn("[node-executor] dubbing: source probe failed; holding the 30-minute ceiling:", err)
  })
  const span = effectiveDubbedSeconds(
    probedSec,
    typeof payload.startTime === "number" ? payload.startTime : undefined,
    typeof payload.endTime === "number" ? payload.endTime : undefined,
  )
  if (span != null && span > DUBBING_MAX_DURATION_SEC) {
    return {
      code: "media_duration_exceeds_limit",
      message:
        `The span to dub is ${Math.ceil(span / 60)} minutes; the maximum is ${DUBBING_MAX_DURATION_SEC / 60} minutes. ` +
        `Trim the clip, or set a start/end window to dub part of it.`,
    }
  }
  if (span != null) payload.probedDurationSec = span
  else payload.reservedCeiling = true
  return undefined
}

/** Workflow dispatch bypasses the HTTP route: apply the same per-minute rate
 * the route charges, marked up once. Hebrew (the project lane) validates and
 * probes its imported source here, before reserving, not after a paid start;
 * every other language prices the span `stampDubbingDuration` stamped, or the
 * 30-minute ceiling when it could not be read. */
export async function projectDubbingCreditOverride(jobName: string, payload: Record<string, unknown>): Promise<number | undefined> {
  if (jobName !== "dubbing") return undefined
  const modelId = dubbingModelIdentifier(payload.targetLanguage)
  const { applyServiceMarkup } = await import("../ee/billing/service-margin.js")
  if (modelId !== "elevenlabs-dubbing-v2") {
    const stamped = typeof payload.probedDurationSec === "number" ? payload.probedDurationSec : undefined
    const plan = dubbingReservePlan(stamped)
    return applyServiceMarkup(await dubbingBaseCredits(payload.targetLanguage, plan.seconds), await getAppSettings(), modelId)
  }
  const url = typeof payload.videoUrl === "string" ? payload.videoUrl : typeof payload.audioUrl === "string" ? payload.audioUrl : undefined
  validateProjectDubbing({ url }, payload)
  const seconds = await probeMediaDuration(url!)
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 1800) throw new Error("Hebrew dubbing requires a readable source no longer than 30 minutes.")
  payload.probedDurationSec = Math.ceil(seconds)
  const { getModelCreditBaseCost } = await import("../ee/billing/credits.js")
  const { creditCost } = await getModelCreditBaseCost("elevenlabs-dubbing-v2")
  return applyServiceMarkup(creditCost * Math.ceil(seconds / 60), await getAppSettings(), "elevenlabs-dubbing-v2")
}
