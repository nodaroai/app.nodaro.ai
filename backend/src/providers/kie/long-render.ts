/**
 * Seedance 2.5 at 4K: a render far slower than the standard poll ceiling
 * (`MAX_POLL_ATTEMPTS_VIDEO`, about 19 minutes) allows, and the budget it gets
 * instead (decided 2026-11-25), sized the way Kling 4.0's 4K and HDR runs are
 * (`kling4PollAttempts`): a measured rate per output second, times a margin.
 *
 * A 4 s text-to-video probe at 4K took 222 s to render (2026-11-22), about 56 s
 * per output second; a 30 s render is not measured. A run is polled for
 * {@link SEEDANCE_25_4K_MARGIN} times that over the clip's seconds, never less
 * than the default: a 30 s clip about 56 minutes. It is recorded under the
 * reconcile kind `kie-long-video` (75 minutes), above that and the stored
 * preview's encode, so the reconcile cron never races a live render.
 *
 * MAGI-2 is slow at its one size, 1080p (decided 2026-11-27): a 30 s clip took
 * 22 min 42 s to render on staging, about 46 s per output second, past the
 * standard ceiling. Its budget is sized the same way at every length, and a run
 * whose budget passes the standard ceiling (longer than 12 s) is a long render.
 */
import { isFourKResolution, maxVideoDurationSec, videoDefaultDurationSec } from "@nodaro/shared/models"
import { MAX_POLL_ATTEMPTS_VIDEO, pollDelay } from "./poll-delay.js"

/** The models whose render at 4K is long. */
const LONG_AT_4K: ReadonlySet<string> = new Set(["seedance-2-5"])

/** Seconds a Seedance 2.5 4K render took per output second (222 s for 4 s, 2026-11-22). */
export const SEEDANCE_25_4K_RENDER_SEC_PER_OUTPUT_SEC = 56
/** The margin over that measure a 4K run is polled for (a 30 s one was not measured). */
export const SEEDANCE_25_4K_MARGIN = 2

/** Seconds a MAGI-2 render took per output second (30 s in 22 min 42 s on staging, 2026-11-27). */
export const MAGI_2_RENDER_SEC_PER_OUTPUT_SEC = 46
/** The margin over that measure a MAGI-2 run is polled for (one long run measured). */
export const MAGI_2_MARGIN = 2

/** The models slow at every size, by their measured render rate. */
const SLOW_AT_EVERY_SIZE: Readonly<Record<string, { readonly secPerOutputSec: number; readonly margin: number }>> = {
  "magi-2": { secPerOutputSec: MAGI_2_RENDER_SEC_PER_OUTPUT_SEC, margin: MAGI_2_MARGIN },
}

/** The measured render rate a run of `model` at `resolution` is sized on, or undefined for a standard run. */
function renderRate(model: string | undefined, resolution: unknown): { readonly secPerOutputSec: number; readonly margin: number } | undefined {
  if (model === undefined) return undefined
  if (LONG_AT_4K.has(model) && isFourKResolution(resolution)) {
    return { secPerOutputSec: SEEDANCE_25_4K_RENDER_SEC_PER_OUTPUT_SEC, margin: SEEDANCE_25_4K_MARGIN }
  }
  return SLOW_AT_EVERY_SIZE[model]
}

/**
 * Whether a KIE video run of `model` at `resolution` (of `duration` seconds) is
 * a long render, recorded under the reconcile kind `kie-long-video`: every
 * Seedance 2.5 run at 4K, and a run of a model slow at every size (MAGI-2)
 * whose budget passes the standard ceiling.
 */
export function isLongKieVideoRender(model: string | undefined, resolution: unknown, duration?: unknown): boolean {
  if (model === undefined) return false
  if (LONG_AT_4K.has(model) && isFourKResolution(resolution)) return true
  if (!SLOW_AT_EVERY_SIZE[model]) return false
  return longRenderPollAttempts(model, { resolution, duration }, MAX_POLL_ATTEMPTS_VIDEO) > MAX_POLL_ATTEMPTS_VIDEO
}

/**
 * The seconds a long render's budget is sized on: the clip's own length when
 * it names one; for Auto (`duration` 0 or below) the model's longest clip —
 * except an EDIT (a Video to Video edit: the declared `edit` task type, or the
 * edit-mode re-send), which renders its source's length, so it is sized on the
 * longest of its reference videos when each one's length is known; and the
 * model's default when no length is sent at all.
 */
function budgetSeconds(model: string, duration: unknown, edit: boolean, referenceVideoSec: ReadonlyArray<number | null> | undefined): number {
  const longest = maxVideoDurationSec(model) ?? 30
  if (typeof duration === "number" && duration > 0) return duration
  if (typeof duration !== "number") return videoDefaultDurationSec(model)
  // Any other Auto run (a reference-to-video run with clips, say) may render up to the longest clip.
  if (!edit) return longest
  const known = referenceVideoSec ?? []
  const allKnown = known.length > 0 && known.every((s) => typeof s === "number" && Number.isFinite(s) && s > 0)
  return allKnown ? Math.min(longest, Math.ceil(Math.max(...(known as number[])))) : longest
}

/**
 * How many times a long-rendering task is polled: the default for a standard
 * run; for Seedance 2.5 at 4K and for MAGI-2 the measured rate × the margin
 * over the seconds it renders (`budgetSeconds`), never less than the default.
 */
export function longRenderPollAttempts(
  model: string,
  input: Readonly<Record<string, unknown>>,
  defaultAttempts: number,
  context: { readonly referenceVideoSec?: ReadonlyArray<number | null>; readonly edit?: boolean } = {},
  pollDelayMs: (attempt: number) => number = pollDelay,
): number {
  const rate = renderRate(model, input.resolution)
  if (!rate) return defaultAttempts
  // The declared edit task type is the edit lane's (`omni_reference_task_type`, the wire key `seedance-edit-mode.ts` names).
  const edit = context.edit === true || input.omni_reference_task_type === "edit"
  const seconds = budgetSeconds(model, input.duration, edit, context.referenceVideoSec)
  const budgetMs = seconds * rate.secPerOutputSec * rate.margin * 1000
  let attempts = 0
  for (let waited = 0; waited < budgetMs; ) waited += pollDelayMs(++attempts)
  return Math.max(defaultAttempts, attempts)
}
