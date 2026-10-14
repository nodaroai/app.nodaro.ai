import { MASK_COMPOSITE_BOUNDS, maskCompositeUnits } from "@nodaro/shared/media"
import { probeVideoSource } from "../providers/video/ffmpeg-utils.js"
import { unitRateBaseCredits } from "./credit-base-cost.js"

/**
 * Mask Composite: how long the result is (its foreground's length), and so how
 * many pricing units a run is charged — one `mask-composite` row per started
 * 5 seconds (`maskCompositeUnits`). One rule for both places a run starts —
 * the route's preHandler (`POST /v1/mask-composite`) and the workflow run
 * (node-executor) — so a composite costs the same wherever it runs. The row is
 * read from `model_pricing`, so an administrator's retune reaches every unit.
 *
 * A foreground that cannot be read is refused: the worker must decode it to
 * composite, so it would fail there anyway, after the reservation.
 */
export type MaskCompositeLength =
  | { readonly ok: true; readonly durationSec: number; readonly units: number }
  | {
      readonly ok: false
      readonly code: "invalid_video_duration" | "video_duration_exceeds_limit"
      readonly message: string
    }

export async function measureMaskCompositeLength(foregroundUrl: string): Promise<MaskCompositeLength> {
  let durationSec: number
  try {
    durationSec = (await probeVideoSource(foregroundUrl)).durationSeconds
  } catch {
    return {
      ok: false,
      code: "invalid_video_duration",
      message: "Could not read the foreground video. The file may be corrupted or an unsupported format.",
    }
  }
  if (durationSec > MASK_COMPOSITE_BOUNDS.MAX_DURATION_SEC) {
    return {
      ok: false,
      code: "video_duration_exceeds_limit",
      message: `The foreground is ${Math.ceil(durationSec)} seconds. Mask Composite takes up to ${MASK_COMPOSITE_BOUNDS.MAX_DURATION_SEC} seconds — trim it first.`,
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
 * payload's foreground and stamps `billedUnits` (what the reservation charges,
 * see `maskCompositeReserveUnits`). Run BEFORE writing input_data. Returns the
 * route's refusal for a foreground it would refuse; undefined otherwise, and
 * for any job that is not a mask-composite run, whose payload is left untouched.
 */
export async function stampMaskCompositeLength(
  jobName: string,
  payload: Record<string, unknown>,
): Promise<{ readonly code: string; readonly message: string } | undefined> {
  if (jobName !== "mask-composite") return undefined
  const url = typeof payload.foregroundUrl === "string" ? payload.foregroundUrl : ""
  const measured = await measureMaskCompositeLength(url)
  if (!measured.ok) return { code: measured.code, message: measured.message }
  payload.billedUnits = measured.units
  return undefined
}

/** The units a stamped mask-composite payload reserves; undefined for any other job. */
export function maskCompositeReserveUnits(jobName: string, payload: Record<string, unknown>): number | undefined {
  return jobName === "mask-composite" && typeof payload.billedUnits === "number" ? payload.billedUnits : undefined
}
