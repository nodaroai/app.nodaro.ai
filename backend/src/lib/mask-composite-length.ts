import { MASK_COMPOSITE_BOUNDS, maskCompositeFillOf, maskCompositeUnits, maskCompositeUsesForeground } from "@nodaro/shared/media"
import { probeVideoSource } from "../providers/video/ffmpeg-utils.js"
import { unitRateBaseCredits } from "./credit-base-cost.js"

/**
 * Mask Composite: how long the result is (its leading video's length — the
 * foreground, or the background when the fill is pixelate / blur), and so how
 * many pricing units a run is charged — one `mask-composite` row per started
 * 5 seconds (`maskCompositeUnits`). One rule for both places a run starts —
 * the route's preHandler (`POST /v1/mask-composite`) and the workflow run
 * (node-executor) — so a composite costs the same wherever it runs. The row is
 * read from `model_pricing`, so an administrator's retune reaches every unit.
 *
 * A leading video that cannot be read is refused: the worker must decode it to
 * composite, so it would fail there anyway, after the reservation.
 */

export type MaskCompositeLength =
  | { readonly ok: true; readonly durationSec: number; readonly units: number }
  | {
      readonly ok: false
      readonly code: "invalid_video_duration" | "video_duration_exceeds_limit"
      readonly message: string
    }

/** Which input a run is measured on: the one the result follows. */
export type MaskCompositeLead = "foreground" | "background"

/**
 * The input a request body or workflow payload is measured on, and its URL.
 * Reads the raw `fill` (before any Zod parse), so an unknown value is the
 * video fill exactly as the route's parse defaults it; with pixelate / blur
 * the background is measured even when a foreground is also sent (it is
 * ignored).
 */
export function maskCompositeLeadOf(body: Readonly<Record<string, unknown>>): { readonly lead: MaskCompositeLead; readonly url: unknown } {
  return maskCompositeUsesForeground(maskCompositeFillOf(body))
    ? { lead: "foreground", url: body.foregroundUrl }
    : { lead: "background", url: body.backgroundUrl }
}
export async function measureMaskCompositeLength(url: string, lead: MaskCompositeLead = "foreground"): Promise<MaskCompositeLength> {
  let durationSec: number
  try {
    durationSec = (await probeVideoSource(url)).durationSeconds
  } catch {
    return {
      ok: false,
      code: "invalid_video_duration",
      message: `Could not read the ${lead} video. The file may be corrupted or an unsupported format.`,
    }
  }
  if (durationSec > MASK_COMPOSITE_BOUNDS.MAX_DURATION_SEC) {
    return {
      ok: false,
      code: "video_duration_exceeds_limit",
      message: `The ${lead} is ${Math.ceil(durationSec)} seconds. Mask Composite takes up to ${MASK_COMPOSITE_BOUNDS.MAX_DURATION_SEC} seconds — trim it first.`,
    }
  }
  return { ok: true, durationSec, units: maskCompositeUnits(durationSec) }
}

/** BASE credits for `units` pricing units: the `mask-composite` row (one unit) times the count (`unitRateBaseCredits`). */
export async function maskCompositeBaseCredits(units: number): Promise<number> {
  return unitRateBaseCredits("mask-composite", Math.max(1, units))
}

/**
 * The workflow run's twin of the route's preHandler: measures a mask-composite
 * payload's leading video (`maskCompositeLeadOf`) and stamps `billedUnits` (what the reservation charges,
 * see `maskCompositeReserveUnits`). Run BEFORE writing input_data. Returns the
 * route's refusal for a foreground it would refuse; undefined otherwise, and
 * for any job that is not a mask-composite run, whose payload is left untouched.
 */
export async function stampMaskCompositeLength(
  jobName: string,
  payload: Record<string, unknown>,
): Promise<{ readonly code: string; readonly message: string } | undefined> {
  if (jobName !== "mask-composite") return undefined
  const { lead, url } = maskCompositeLeadOf(payload)
  const measured = await measureMaskCompositeLength(typeof url === "string" ? url : "", lead)
  if (!measured.ok) return { code: measured.code, message: measured.message }
  payload.billedUnits = measured.units
  return undefined
}

/** The units a stamped mask-composite payload reserves; undefined for any other job. */
export function maskCompositeReserveUnits(jobName: string, payload: Record<string, unknown>): number | undefined {
  return jobName === "mask-composite" && typeof payload.billedUnits === "number" ? payload.billedUnits : undefined
}
