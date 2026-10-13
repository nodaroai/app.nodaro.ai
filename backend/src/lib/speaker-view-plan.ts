/**
 * speaker-view — the per-output-minute price and the workflow run's reserve
 * (C4, decided 2026-10-10). The twin of `apply-edl-plan.ts`.
 *
 * Speaker View is priced by how many speakers it composites at once (the tier,
 * `speakerViewPriceTier` in `@nodaro/render-rules`), per minute of output:
 *
 *   | tier                         | preview (`proxy`) | final |
 *   | `standard` (1–2 tiles)       | 2                 | 10    |
 *   | `complex` (3–6 tiles, zoom)  | 3                 | 12    |
 *
 * A render reserves `rate × ceil(edlDurationMs(edit as given) / 60000)`
 * (minimum one minute) on the row `speakerViewCreditId(quality, tier)` names.
 * Two sites take that reserve and must agree: the cloud plugin's route
 * (`POST /v1/speaker-view`, a BASE figure its credit guard marks up) and the
 * workflow run (`speakerViewCreditOverride` below, already marked up). The
 * cross-repo fixture `__tests__/fixtures/speaker-view-pricing-cases.json`
 * holds the plugin's route to this file's numbers.
 *
 * The CHARGE is the rendered cut's own length (SV14 b, decided 2026-10-06):
 * turn splitting with a crossfade switch can shorten the output, so the
 * plugin's handler commits `rate × ceil(edlDurationMs(edit as drawn) /
 * 60000)` and the rest of the reserve is released. It reads the rate the
 * reserve used from the job (`reservedCreditsPerMinute`, stamped here), so an
 * admin retune of a row moves the reserve and the charge together.
 */
import { type Edl, edlDurationMs, speakerViewCreditId, SPEAKER_VIEW_CREDIT_IDS, type SpeakerViewCreditId } from "@nodaro/shared"
import { baseCreditCostFor, quoteBaseCredits } from "./credit-base-cost.js"

/** Base credits per minute of rendered output, per row (decided 2026-10-10).
 *  The ONE value behind `STATIC_CREDIT_COSTS`, the `model_pricing` rows, the
 *  editor's cold-cache rows and the docs' worked examples; tests pin each copy
 *  to it. Keyed by every id `speakerViewCreditId` can name, so an id it gains
 *  cannot compile here without a rate. */
export const SPEAKER_VIEW_CREDITS_PER_OUTPUT_MINUTE: Readonly<Record<SpeakerViewCreditId, number>> = Object.freeze({
  // 1–2 tiles, no zoom: Apply EDL's figures for a final (10) and the preview
  // rate decided for Speaker View (2).
  "speaker-view": 10,
  "speaker-view:proxy": 2,
  // 3–6 tiles, or any zoom: what a six-camera grid and a long zoom edit cost.
  "speaker-view:complex": 12,
  "speaker-view:complex:proxy": 3,
})

/** Is this one of Speaker View's credit ids? */
export function isSpeakerViewCreditId(id: unknown): id is SpeakerViewCreditId {
  return typeof id === "string" && (SPEAKER_VIEW_CREDIT_IDS as readonly string[]).includes(id)
}

/** Minutes of output a render of `edl` reserves for: `ceil(edlDurationMs /
 *  60000)`, at least one. The edit as GIVEN (its crossfades already counted
 *  as overlap): the turn split happens after the reserve, and only ever keeps
 *  or shortens it. */
export function speakerViewReserveMinutes(edl: Edl): number {
  return Math.max(1, Math.ceil(edlDurationMs(edl) / 60_000))
}

/** BASE credits (pre-markup) for a render of `edl` on `creditId`, at the code's
 *  own rates — what the cloud plugin's route reserves today (its guard marks it
 *  up; the plugin keeps its own copy of these rates). The workflow run does NOT
 *  price with this: it reads the admin-editable row (`speakerViewCreditOverride`).
 *  The cross-repo parity fixture pins the plugin to these figures. */
export function speakerViewBaseCredits(edl: Edl, creditId: SpeakerViewCreditId): number {
  return SPEAKER_VIEW_CREDITS_PER_OUTPUT_MINUTE[creditId] * speakerViewReserveMinutes(edl)
}

const parse = (v: unknown): unknown => {
  if (typeof v !== "string") return v
  try { return JSON.parse(v) } catch { return undefined }
}

/**
 * The workflow run's reserve (the twin of `applyEdlCreditOverride`): the
 * dispatch bypasses the plugin's route, so it reserves the same per-minute
 * base × minutes, marked up, on the row the payload builder named
 * (`reservedCreditId`; the dearer row of the payload's quality when it names
 * none). The rate is read from `model_pricing`, which an admin row can
 * override, and stamped on the payload as `reservedCreditsPerMinute` for the
 * handler's commit (SV14 b). `undefined` for any other job, so the `??` chain
 * in node-executor falls through.
 */
export async function speakerViewCreditOverride(
  jobName: string,
  payload: Record<string, unknown>,
): Promise<number | undefined> {
  if (jobName !== "speaker-view") return undefined
  const edl = parse(payload.edl) as Edl | undefined
  if (!edl || typeof edl !== "object" || !Array.isArray(edl.segments)) return undefined
  const creditId = isSpeakerViewCreditId(payload.reservedCreditId) ? payload.reservedCreditId : speakerViewCreditId(payload.quality)
  const minutes = speakerViewReserveMinutes(edl)
  // ONE read of the row: the rate stamped for the handler's commit, and the
  // reserve — that rate × the minutes, rounded up once (`quoteBaseCredits`,
  // the composition `unitRateBaseCredits` and the whole-run quote use).
  const rate = await baseCreditCostFor(creditId)
  payload.reservedCreditsPerMinute = rate
  const { applyServiceMarkup } = await import("../ee/billing/service-margin.js")
  const { getAppSettings } = await import("./app-settings.js")
  return applyServiceMarkup(quoteBaseCredits(rate, minutes), await getAppSettings(), creditId)
}
