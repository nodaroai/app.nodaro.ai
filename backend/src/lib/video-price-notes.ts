import type { FastifyRequest } from "fastify"
import { isAutoVideoDuration } from "@nodaro/shared/model-catalog"
import { isQuoting, noteAdjustment, noteExpectedBase, noteWarning } from "./price-notes.js"

/**
 * The quote notes the video routes' pricing writes (see `price-notes.ts`). One
 * copy for /v1/text-to-video and /v1/generate-video, called from inside their
 * `computeCredits` with the very numbers that priced the request. Every
 * function is a no-op unless a quote is pricing this request, so a run pays
 * nothing for them.
 */

const usable = (d: number): boolean => Number.isFinite(d) && d > 0

const SETTLES_TO_ACTUAL = {
  code: "settles_to_actual",
  message: "The run is charged for the seconds actually generated; the difference from the reserve is refunded when it finishes.",
} as const

/**
 * A run priced by the length of its reference clips (Seedance 2.x, MiniMax
 * Hailuo 3): what was measured, what could not be, and — for Seedance, whose
 * run settles to what it rendered — the cost it should actually come to.
 */
export async function noteRefVideoPricing(req: FastifyRequest, args: {
  provider: string
  resolution: string
  outputDurationSec: number
  /** The request's own duration (Auto = the edit shape). */
  rawDuration: unknown
  durationsSec: readonly number[]
  /** The run settles to what it rendered (Seedance 2.x). */
  settlesToActual: boolean
}): Promise<void> {
  if (!isQuoting(req)) return
  const measured = args.durationsSec.filter(usable)
  const totalSec = Math.round(measured.reduce((a, d) => a + d, 0) * 10) / 10
  noteAdjustment(req, {
    code: "ref_video_length",
    message: `Priced by length: the ${args.durationsSec.length} reference clip(s) (${totalSec}s measured) are billed with the output.`,
  })
  if (measured.length < args.durationsSec.length) {
    noteWarning(req, {
      code: "ref_video_unmeasured",
      message: "A reference clip could not be measured, so it is priced as the longest clip the model accepts.",
    })
  }
  if (!args.settlesToActual) return
  const { seedance2RefVideoExpectedBaseCredits } = await import("../ee/billing/seedance2-ref-video-credits.js")
  const expected = seedance2RefVideoExpectedBaseCredits({
    provider: args.provider,
    resolution: args.resolution,
    outputDurationSec: args.outputDurationSec,
    autoDuration: isAutoVideoDuration(args.rawDuration),
    durationsSec: args.durationsSec,
  })
  if (expected !== undefined) noteExpectedBase(req, expected)
  noteWarning(req, SETTLES_TO_ACTUAL)
}

/** MiniMax Hailuo 3: input images past the free allowance are charged. */
export function noteExtraReferenceImages(req: FastifyRequest, args: { count: number; free: number }): void {
  if (args.count <= args.free) return
  noteAdjustment(req, {
    code: "extra_reference_images",
    message: `${args.count} reference images: the first ${args.free} are included, ${args.count - args.free} are charged extra.`,
  })
}

/** An Auto-duration run with no reference clip (Seedance 2.x): reserved at the
 *  model's longest clip, settled to the length it picked. */
export function noteAutoDurationSettles(req: FastifyRequest): void {
  noteAdjustment(req, {
    code: "auto_duration",
    message: "Auto duration: reserved at the model's longest clip, since the model picks the length.",
  })
  noteWarning(req, SETTLES_TO_ACTUAL)
}

/** A separately priced add-on folded into the run's price (generate-video). */
export function noteAddon(req: FastifyRequest, code: "loop_trim_addon" | "voiced_audio_addon", baseCredits: number): void {
  if (baseCredits <= 0) return
  noteAdjustment(req, {
    code,
    message: code === "loop_trim_addon" ? "Includes the seamless-loop trim." : "Includes the character voice track.",
    baseCredits,
  })
}
