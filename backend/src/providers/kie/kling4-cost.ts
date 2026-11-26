import { isKling4FlashProvider, normalizeKling4Resolution, videoHdrResolution } from "@nodaro/shared/models"

import { KIE_CREDIT_USD } from "./models.js"

/**
 * What KIE bills for a Kling 4.0 render (`kling-4`, `kling-4-keyframes`,
 * `kling-4-flash`), recorded as the job's provider cost (`jobs.provider_cost`).
 * Recorded only: it reaches the commit as `result.cost`, and the charge — the
 * reserved tier, or the measured count of a reference-video run settled from
 * its delivered clip — never reads it.
 *
 * Per-second rates in KIE credits (each `KIE_CREDIT_USD`), from KIE's price
 * pages (Kling 4.0 live-billed 2026-10-23; Flash read 2026-11-11): `plain`
 * without a reference video, billed on the output seconds; `ref` with one,
 * billed on output + the longer of output and the reference clips' seconds.
 * Kling 4.0 Flash renders 720p only, at one rate on both of its endpoints.
 * 4K and the HDR add-on read 2026-11-22; HDR is billed on the OUTPUT seconds
 * only, at its own rate per size, beside the clip's rate (measured the same
 * day: a 3 s 1080p HDR run billed 3 × (42.5 + 8.5)).
 */
export const KLING_4_KIE_CREDITS_PER_SEC: Readonly<Record<"720p" | "1080p" | "4k", { plain: number; ref: number }>> = {
  "720p": { plain: 28.5, ref: 17 },
  "1080p": { plain: 42.5, ref: 25.5 },
  "4k": { plain: 99, ref: 59 },
}
/** The HDR add-on per OUTPUT second, by the HDR size (1080p and 4K only). */
export const KLING_4_HDR_KIE_CREDITS_PER_SEC: Readonly<Record<"1080p" | "4k", number>> = {
  "1080p": 8.5,
  "4k": 14,
}
export const KLING_4_FLASH_KIE_CREDITS_PER_SEC = { plain: 17, ref: 11.3 } as const

/** The rate a run renders at: Flash's own, else Kling 4.0's at the resolution it renders. */
function rateFor(provider: string, resolution: string | undefined): { plain: number; ref: number } {
  return isKling4FlashProvider(provider) ? KLING_4_FLASH_KIE_CREDITS_PER_SEC : KLING_4_KIE_CREDITS_PER_SEC[normalizeKling4Resolution(resolution)]
}

/**
 * The USD KIE bills for a Kling 4.0 render. With a reference video the `ref`
 * rate covers `outputSec + max(outputSec, inputSec)` — the seconds the
 * credit charge bills (`billedRefVideoSeconds`); without one the `plain` rate
 * covers `outputSec`. An HDR run adds the HDR rate on `outputSec` alone.
 */
export function kling4CostUsd(o: {
  provider: string
  resolution: string | undefined
  /** The run's dynamic range (`"hdr"` on an HDR run); required so no caller can leave HDR out. */
  dynamicRange: unknown
  hasVideoRef: boolean
  outputSec: number
  inputSec: number
}): number {
  const rate = rateFor(o.provider, o.resolution)
  const kieCredits = o.hasVideoRef ? rate.ref * (o.outputSec + Math.max(o.outputSec, o.inputSec)) : rate.plain * o.outputSec
  const hdr = videoHdrResolution(o.provider, o.resolution, o.dynamicRange) as "1080p" | "4k" | undefined
  const hdrCredits = hdr ? KLING_4_HDR_KIE_CREDITS_PER_SEC[hdr] * o.outputSec : 0
  return (kieCredits + hdrCredits) * KIE_CREDIT_USD
}
